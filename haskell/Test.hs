import Control.Concurrent (newMVar, newEmptyMVar, MVar, withMVar, modifyMVar, modifyMVar_, putMVar, takeMVar, threadDelay, swapMVar, readMVar)
import Control.Monad.Cont (liftIO)
import Control.Monad (join, replicateM)

import AsyncM
import Progress
import Stream
import Signal

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
    rate _ r = r


test2 = do
  runM_ (runWithAdjust s1 100 (\r a -> (a, r)) work) h
  where
    h (sa, sc) = do run sa $ \x -> putStrLn ("{" <> show x <> "}")
                    run (takeS 30 sc) print



