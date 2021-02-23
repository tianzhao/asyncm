
module Stream
  (
    Stream (..)
  , joinS 
  , runS 
  , run
  , liftS
  , firstS
  , leftApp
  , broadcast_
  , broadcast
  , receive
  , multicast_
  , multicast
  , interval
  , interval'
  , interval_
  , accumulate
  , foldS
  , countS
  , untilS
  , appS
  , speedS
  , requestS
  , takeS
  , takeS_
  , foreverS
  , stopS
  , zipS
  , fromList
  , zipWithIndex
  , controlS
  , mergeS
  , DTime (..)
  , fetchS
  , concatS
  , justS
  , dropS
  , delayS
  , delayS_
  , minChangeInterval
  , sampleInterval
  , switchMap
  , controlS'
  , controlS''
  , repeatS
  ) where

import Control.Monad (join)
import Control.Monad.Cont (liftIO)
import AsyncM (AsyncM (..), ifAliveM, raceM, runM_, timeout, neverM, forkM, advM, commitM, cancelM, scopeM, unscopeM, allM, anyM)
import Emitter (Emitter (..), emit, listen, newEmitter_, spawnM, waitE, now)
import Progress (Progress (..), cancelP)
import Control.Monad.IO.Class (MonadIO)
import Control.Concurrent.Chan (newChan, readChan, writeChan)
import Data.Maybe (fromJust)

type DTime = Int

data Stream a = Next (Maybe a) (AStream a)  
              | End (Maybe a)

type AStream a = AsyncM (Stream a)

-----------------------------------------------------------------------

instance MonadIO Stream where
  liftIO a = Next Nothing (do x <- liftIO a 
                              return $ pure x)

instance Functor Stream where
  fmap f (Next a m) = Next (f <$> a) (fmap f <$> m)
  fmap f (End a) = End (f <$> a)

instance Applicative Stream where
  pure x = End (Just x)

  sf <*> sx = do f <- sf
                 x <- sx
                 return $ f x

instance Monad Stream where
  return = pure
  s >>= k = joinS $ fmap k s

joinS :: Stream (Stream a) -> Stream a
joinS (End Nothing)  = End Nothing
joinS (End (Just s)) = s
joinS (Nothing `Next` mss) = Nothing `Next` (joinS <$> mss)
joinS ( Just s `Next` mss) = s `switchS` mss

switchS :: Stream a -> AStream (Stream a) -> Stream a
switchS (a `Next` ms) mss = a `Next` (h ms =<< spawnM mss)
  where h ms mss = do
          r <- anyM mss (unscopeM ms)
          return $ case r of Left ss -> joinS ss
                             Right (End a) -> a `Next` (joinS <$> mss)
                             Right (a `Next` ms') -> a `Next` h ms' mss 
switchS (End a) mss = a `Next` (joinS <$> mss)
          
concatS :: Stream a -> Stream a -> Stream a
concatS (End a) s = Next a $ pure s
concatS (Next a m) s = Next a $ (`concatS` s) <$> m

-----------------------------------------------------------------------

liftS :: AsyncM a -> Stream a
liftS m = Next Nothing (m >>= return . pure)

-- run the input stream until the first Just event is emitted
firstS :: Stream a -> Stream a
firstS (End x) = End x
firstS (Next Nothing ms) = Next Nothing (firstS <$> ms)
firstS (Next (Just x) _) = End (Just x)

leftApp :: Stream (a -> b) -> Stream a -> Stream b
leftApp sf sx = sf <*> firstS sx


-----------------------------------------------------------------------

runS :: Stream a -> (a -> IO ()) -> AsyncM ()
runS (End Nothing) _  = return ()
runS (End (Just x)) k = ifAliveM >> liftIO (k x)
runS (Next a ms) k = do ifAliveM
                        liftIO $ maybe (return ()) k a 
                        ms >>= flip runS k  

run :: Stream a -> (a -> IO ()) -> IO ()
run s k = runM_ (runS s k) return 

-- run s with k and the cancel s after it ends
run_ :: Stream a -> (a -> IO ()) -> IO ()
run_ s k = runM_ (runS s k >> cancelM) return 

-- emit the first index after 1 ms delay
interval :: Int -> Int -> Stream Int
interval dt n = Next Nothing (timeout 1 >> h 1)
  where h x = if x >= n then return $ End (Just x)
              else do ifAliveM
                      return $ Next (Just x) (timeout dt >> h (x+1))
--interval dt n = delayS 1 $ fromList [1..n]

broadcast_ :: Stream a -> AsyncM (Emitter a, Progress)
broadcast_ s = do 
   e <- liftIO newEmitter_ 
   p <- forkM $ runS s $ emit e 
   return (e, p)

broadcast :: Stream a -> AsyncM (Emitter a)
broadcast s = fst <$> broadcast_ s

receive :: Emitter a -> Stream a
receive e = Next Nothing h
  where h = do a <- listen e
               ifAliveM
               return $ Next (Just a) h

multicast_ :: Stream a -> Stream (Stream a, Progress)
multicast_ s = Nothing `Next` do (e, p) <- broadcast_ s
                                 return $ pure (receive e, p)

multicast :: Stream a -> Stream (Stream a)
multicast s = fst <$> multicast_ s 

-----------------------------------------------------------------------

            
appS :: Stream (a -> b) -> Stream a -> Stream b
appS (Next f msf) (Next x msx) = Next (f <*> x)  
  (do mf <- spawnM msf
      mx <- spawnM msx
      anyM mf mx >>= either (\sf -> return $ appS sf $ Next x mx)
                            (\sx -> return $ appS (Next f mf) sx) 
  )
appS (End f) (End x) = End (f <*> x)
appS (End f) (Next x msx) = Next (f <*> x) (appS (End f) <$> msx)
appS (Next f msf) (End x) = Next (f <*> x) (flip appS (End x) <$> msf)


mergeS :: Stream a -> Stream a -> Stream a
mergeS (Next a ma) (Next b mb) = Next a $ return (Next b $ h ma mb)
  where h ma mb = do ma' <- spawnM ma
                     mb' <- spawnM mb
                     anyM ma' mb' >>= either (\(Next a ma) -> return $ Next a $ h ma mb')
                                             (\(Next b mb) -> return $ Next b $ h ma' mb) 

mergeS (End a) (End b) = Next a (return $ End b)
mergeS (End a) s = Next a $ return s
mergeS (Next a msa) (End b) = Next a $ return (Next b msa)


-----------------------------------------------------------------------

zipS :: Stream a -> Stream b -> Stream (a, b)
zipS (End a1) (End a2) = End (pure (,) <*> a1 <*> a2)
zipS (End a1) (Next a2 ms2) = End (pure (,) <*> a1 <*> a2)
zipS (Next a1 ms1) (End a2) = End (pure (,) <*> a1 <*> a2)
zipS (Next a1 ms1) (Next a2 ms2) = Next (pure (,) <*> a1 <*> a2) ms 
  where ms = do (s1, s2) <- allM ms1 ms2
                ifAliveM
                return $ zipS s1 s2

repeatS :: AsyncM a -> Stream a
repeatS m = Next Nothing (repeatA m)

repeatS' :: a -> AsyncM a -> Stream a
repeatS' a m = Next (Just a) (repeatA m)


repeatA :: AsyncM a -> AStream a
repeatA m = do a <- m
               ifAliveM
               return $ Next (Just a) (repeatA m)

foreverS :: Int -> Stream ()
foreverS dt = repeatS $ timeout dt

fromList :: [a] -> Stream a
fromList [] = End Nothing 
fromList (a:t) = Next (Just a) (return $ fromList t)

zipWithIndex :: Stream a -> Stream (Int, a)
zipWithIndex s = zipS (fromList [1..]) s

-- get rid of Nothing except possibly the first one
justS :: Stream a -> Stream a
justS (End a) = End a
justS (Next a ms) = Next a (ms >>= h)
  where h (Next Nothing ms)  = ms >>= h
        h (Next (Just x) ms) = return $ Next (Just x) (ms >>= h)
        h (End a)            = return $ End a

-- take the first n events. If n <= 0, then nothing
-- if 's' has less than n events, the 'takeS n s' emits all events of s
takeS :: Int -> Stream a -> Stream a
takeS n s = if n <= 0 then End Nothing else f n s
  where f 1 (Next (Just x) _) = End (Just x)
        f n (Next a ms)       = Next a $ takeS (maybe n (\_->n-1) a) <$> ms
        f _ (End a)           = End a


-- explicitly cancel a stream after it reaches the 'End'
endS (End a) = End a
endS (Next a ms) = Next a $ scopeM $ f ms
  where f m = do s <- m
                 case s of End a -> cancelM >> return (End a) 
                           Next a m' -> return $ Next a $ f m'

-- FIXME can ends before n events
-- take n events from s and cancel s explicitly
takeS_ n s = endS $ takeS n s

-- drop the first n events
-- if 's' has less than n events, then 'dropS s' never starts.
dropS :: Int -> Stream a -> Stream a
dropS n s = justS (h n s)
  where h n s | n <= 0 = s 
              | otherwise = case s of End _ -> End Nothing
                                      Next _ ms -> Next Nothing (h (n-1) <$> ms)

-- wait dt milliseconds and then start 's'
waitS :: DTime -> Stream a -> Stream a
waitS dt s = Next Nothing (timeout dt >> return s)

-- skip the events of the first dt milliseconds  
skipS :: DTime -> Stream a -> Stream a
skipS dt s = do s' <- multicast s 
                waitS dt s'

-- delay each event of 's' by dt milliseconds
delayS :: DTime -> Stream a -> Stream a
delayS dt s = Next Nothing (h s)
  where h (Next a ms) = timeout dt >> (return $ Next a (ms >>= h))
        h (End a) = timeout dt >> (return $ End a)

-- does not affect the initial event
delayS_ :: DTime -> Stream a -> Stream a
delayS_ dt (End a)     = End a
delayS_ dt (Next a ms) = Next a (timeout dt >> (delayS_ dt <$> ms))


-- stop 's' after dt milliseconds
stopS :: DTime -> Stream a -> Stream a
-- stopS dt s = s `untilS` (timeout dt >> return (End Nothing))
stopS _ (End a) = End a
stopS dt s = s `switchS` (timeout dt >> return (End Nothing))

-- start the first index after dt
interval' :: DTime -> Int -> Stream Int
interval' dt n = delayS dt $ fromList [1..n]

interval_ :: DTime -> Int -> Stream Int
interval_ dt n
    | n > 0     = delayS_ dt $ fromList [1..n]
    | otherwise = End Nothing

-----------------------------------------------------------------------

-- fold the functions emitted from s with the initial value a
accumulate :: a -> Stream (a -> a) -> Stream a
accumulate a (Next f ms) = let a' = maybe a ($ a) f  
                           in Next (Just a') (accumulate a' <$> ms)
accumulate a (End f) = End (Just $ maybe a ($ a) f) 

lastS :: Stream a -> AsyncM () -> AsyncM (Maybe a)
lastS s m = spawnM m >>= flip h s
  where h m (Next a ms) = anyM ms m >>= either (h m) (\() -> return a) 
        h m (End a) = m >> return a

-- fold the functions emitted from s for n milli-second with the initial value c 
foldS :: DTime -> a -> Stream (a -> a) -> AsyncM a
foldS n c s = fromJust <$> lastS (accumulate c s) (timeout n) 

-- emit the number of events of s for every n milli-second
countS :: DTime -> Stream b -> AsyncM Int
countS n s = foldS n 0 $ (+1) <$ s 

-- run s until ms occurs and then runs the stream in ms
untilS :: Stream a -> AStream a -> Stream a
untilS s ms = joinS $ Next (Just s) (pure <$> ms)


-----------------------------------------------------------------------

-- fetch data by sending requests as a stream of AsyncM and return the results in a stream
fetchS :: Stream (AsyncM a) -> Stream a
fetchS sm = Next Nothing $ do c <- liftIO newChan
                              forkM $ runS (sm >>= liftS . spawnM) (writeChan c)  
                              repeatA $ join $ liftIO (readChan c) 

-- measure the data speed = total sample time / system time
speedS :: DTime -> Stream (DTime, a) -> AsyncM Float
speedS n s = f <$> (foldS n 0 $ (\(dt,_) t -> t + dt) <$> s)
  where f t = fromIntegral t / fromIntegral n

-- call f to request samples with 'dt' interval and 'delay' between requests
requestS :: (DTime -> AsyncM a) -> DTime -> DTime -> Stream (DTime, a)
requestS f dt delay = (,) dt <$> s
  where s = fetchS $ f dt <$ foreverS delay

controlS :: (t -> Stream (AsyncM a)) -> Int -> t -> (Bool -> t -> t) -> Stream (t, a) 
controlS req_fun duration dt adjust = join $ h dt  
  where h dt = do (request,  p1) <- multicast_ $ req_fun dt 
                  (response, p2) <- multicast_ $ fetchS request 
     
                  let mss = do timeout duration 
                               (x, y) <- allM (countS duration response)
                                              (countS duration request)
                               liftIO $ print(x, y)
                               if x == y then mss
                               else do liftIO $ cancelP p1 >> cancelP p2
                                       return $ h $ adjust (x < y) dt 
                  Just ((,) dt <$> response) `Next` mss

-----------------------------------------------------------------------

minChangeInterval :: DTime -> Stream a -> Stream a
minChangeInterval _  (End a)     = End a
minChangeInterval dt (Next a ms) =
  Next a $ return . (minChangeInterval dt) . fst =<< allM ms (timeout dt)

-- TODO cancel
sampleInterval :: DTime -> Stream a -> Stream a
sampleInterval dt (End a)      = End a
sampleInterval dt s@(Next a _) = Next a ms
  where ms = do (e, p) <- broadcast_ s
                return $ delayS_ dt $ repeatS $ liftIO $ now e

switchMap :: Stream (Stream a -> Stream b) -> Stream a -> Stream b
switchMap sf sa = do
  sf' <- multicast sf
  sa' <- multicast sa
  let h (End f)      = mf f sa'
      h (Next f msf) = mf f sa' `untilS` (return . h =<< msf)
  h sf'
  where mf = maybe nothingS id


nothingS (End _)     = End Nothing
nothingS (Next _ ms) = Next Nothing (nothingS <$> ms)


controlS' :: Stream a -> Stream DTime -> Stream a
controlS' sa st = do
    st' <- multicast st
    switchMap (return . delayS_ =<< st') sa

controlS'' :: Stream a -> Stream DTime -> Stream (DTime, a)
controlS'' sa st = do
    st' <- multicast st
    switchMap (return . (\t -> delayS_ t . ((,) t <$>)) =<< st') sa

