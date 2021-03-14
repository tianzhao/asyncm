
import AsyncM
import Emitter
import Progress
import Signal
import Stream

import Control.Concurrent
import Control.Concurrent.Async
import Control.Monad
import Control.Monad.Cont
import Data.Maybe
import Numeric

fMVar :: (a -> a) -> MVar a -> IO ()
fMVar f v = modifyMVar_ v (return . f)

runWithStat :: Stream a -> DTime -> (a -> IO b) -> AsyncM (Stream b, Signal IO (Int,Int))
runWithStat s dt f = do
  bufszVar <- liftIO $ newMVar 0
  countVar <- liftIO $ newMVar 0
  recvSig <- push2pull' s (fMVar (+1) bufszVar)
  let recvSig' = bindG recvSig (\a -> fMVar (+(-1)) bufszVar *> f a <* fMVar (+1) countVar)
  let mb = reactimate dt recvSig'
  let mp = Signal $ do c <- liftIO $ swapMVar countVar 0
                       b <- liftIO $ readMVar bufszVar
                       return ((b, c), mp)
  return (mb, mp)


s1 = interval 100 20
s1d = zipS s1 (fromList [100,200,300,50,10,5,8,3,1,1,1])

work (a,x) = threadDelay (x * 1000) >> return (a, x)

-- problem with sc: can't skip events from signal

test1 = do
  runM_ (runWithStat s1d 100 work) h
  where
    h (sa, sc) = do run sa $ \x -> putStrLn ("{" <> show x <> "}")
                    run (takeS 30 $ reactimate 100 sc) print


runWithAdjust :: Stream a -> DTime -> (Int -> a -> (a,Int)) -> ((a,Int) -> IO b) -> AsyncM (Stream b, Stream (Int, Int))
runWithAdjust s dt g f = do
  bufszVar <- liftIO $ newMVar 0
  countVar <- liftIO $ newMVar 0
  rrateVar <- liftIO $ newMVar 0

  recvSig <- push2pull' s (fMVar (+1) bufszVar)

  let resampledSig = bindG recvSig $ \a -> do x <- readMVar rrateVar
                                              return $ g x a

  let recvSig' = bindG resampledSig $ \a -> do fMVar (+(-1)) bufszVar
                                               b <- f a
                                               fMVar (+1) countVar
                                               return b
  let mb = reactimate dt recvSig'
  let mp = Signal $ do c <- liftIO $ swapMVar countVar 0
                       b <- liftIO $ readMVar bufszVar
                       return ((b, c), mp)

  -- stop this
  emiter <- broadcast $ reactimate dt mp
  let mp' = receive emiter

  liftIO $ run mp' $ \bc -> fMVar (rate bc) rrateVar

  return (mb, mp')
  where
    rate (b, 0) r = if (r-5) <= 0 then 0 else (r-5)
    rate (0, c) r = if (r+5) > dt then dt else (r+5)
    rate _ r      = r


test2 = do
  runM_ (runWithAdjust s1 100 (\r a -> (a, r)) work) h
  where
    h (sa, sc) = do run sa $ \x -> putStrLn ("{" <> show x <> "}")
                    run (takeS 30 sc) print



controlS' :: (Stream a -> AsyncM b)             -- measure
          -> (s -> b -> (s, Maybe (Stream a)))  -- update
          -> s                                  -- initial state
          -> Stream a                           -- source
          -> Stream a
controlS' measure update r sa = do
  e <- liftS $ liftIO newEmitter_
  let Next _ ms = receive e
  let sa' = switchS sa ms

  -- stop this when sa' ends
  (sa'', p) <- multicast_ sa'

  liftS $ forkM (mon e sa'' r)
  sa''
  where
    mon e sa r = do
      y <- measure sa
      let (r', y') = update r y
      when (isJust y') $ liftIO $ emit e (fromJust y')
      mon e sa r'

controlS'' :: (Stream a -> AsyncM b)    -- measure
           -> (s -> b -> (s, Maybe c))  -- update predicate
           -> s                         -- initial state
           -> (c -> Stream a)           -- construct stream
           -> c                         -- initial value used to construct the stream
           -> Stream a
controlS'' measure pred r f c0 = controlS' measure (\r y -> fmap (fmap f) (pred r y)) r (f c0)


i1 = [1..10]
i2 = [1,10,5,40,20,50]

mki lst = foldr concatS (End Nothing) (map (\x -> delayS (x*300) (pure x)) lst)

c1 = controlS'' (countS 1000) update 0 (\b -> if b then mki i1 else mki i2) True
  where
    update s b =
      if s == 3
      then (s+1, Just False)
      else (s+1, Nothing)

test3 = run c1 print


c2 = controlS'' (countS 1000) update 0 f (5, 0)
  where
    f (d, i) = delayS (d*100) $ (zipS (fromList [d,d..]) (fromIntegral <$> fromList [i,i+1..]))

    update s b =
      if s == 5 then (s+1, Just (10, b))
      else if s == 10 then (s+1, Just (2, b))
      else (s+1, Nothing)


showF d n = showFFloat (Just d) n ""

test4 = run c2 (\(d, i) -> print $ showF d (sin i))


