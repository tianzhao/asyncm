
module Signal
  (
    reactimate
  , reactimateB
  , stepper
  , fetchG
  , fetchS
  , push2pull
  ) where

import Control.Monad.Reader (ReaderT (..))
import Control.Monad.Cont (liftIO)
import AsyncM (AsyncM (..), ifAliveM, timeout, forkM)
import Control.Concurrent.Chan (newChan, readChan, writeChan)
import Stream (fetchS, Stream (..), runS, Time (..))


-- Pull-based stream
newtype Signal m a = Signal { runSignal ::  m (a, Signal m a) }

instance (Monad m) => Functor (Signal m) where
  fmap f (Signal m) = Signal $ do (a, s) <- m 
                                  return (f a, fmap f s)

instance (Monad m) => Applicative (Signal m) where
  pure a = Signal $ return (a, pure a)
 
  Signal mf <*> Signal mx = 
       Signal $ do (f, sf) <- mf
                   (x, sx) <- mx 
                   return (f x, sf <*> sx)

-- buffer events from stream s as a signal
push2pull :: Stream a -> AsyncM (Signal IO a)
push2pull s =  do 
     c <- liftIO newChan
     forkM $ runS s $ writeChan c 
     let f = do a <- readChan c
                return (a, Signal f)
     return $ Signal f

-- run k for each event of the signal s
bindG :: Signal IO a -> (a -> IO b) -> Signal IO b
bindG s k = Signal $ do 
     (a, s') <- runSignal s
     b <- k a
     return (b, bindG s' k)

-- fetch data by sending requests as a stream and return the results in the order of the requests
fetchG :: Stream (AsyncM a) -> AsyncM (Signal IO a)
fetchG s = push2pull $ fetchS s

-- run signal with event delay
reactimate :: Time -> Signal IO a -> Stream a
reactimate delay g = Next Nothing (h g)
  where h g = do timeout delay
                 ifAliveM
                 (a, g') <- liftIO $ runSignal g 
                 return $ Next (Just a) (h g')

-----------------------------------------------------------------------

-- Event is a signal of delta-time and value pairs
type Event a = Signal IO (Time, a)

-- Behavior is a signal of delta-time to value functions
type Behavior a = Signal (ReaderT Time IO) a

-- make an event out of a stream of AsyncM
fetchE :: Time -> (Time -> Stream (AsyncM a)) -> AsyncM (Event a)
fetchE dt k = push2pull $ fetchES dt k

fetchES :: Time -> (Time -> Stream (AsyncM a)) -> Stream (Time, a)
fetchES dt k = (,) dt <$> (fetchS $ k dt)

-- a behavior that synchronously fetches data, which is blocking and will experience all IO delays
fetchB :: (Time -> IO a) -> Behavior a
fetchB k = Signal $ ReaderT $ \t -> do a <- k t
                                       return (a, fetchB k)

-- Converts an event signal to a behavior signal 
-- downsample by applying the summary function
-- upsample by repeating events
stepper :: ([(Time, a)] -> a) -> Event a -> Behavior a
stepper summary ev = Signal $ ReaderT $ \t -> h [] t ev
 where h lst t ev = do 
         ((t', a), ev') <- runSignal ev   
         if (t == t') then return (f ((t,a):lst), stepper summary ev') 
         else if (t < t') then return (f ((t,a):lst), stepper summary $ Signal $ return ((t'-t, a), ev'))
         else h ((t',a):lst) (t-t') ev' 
       f [(t,a)] = a
       f lst = summary lst 
     
-- run behavior with event delay and sample delta-time
reactimateB :: Time -> Time -> Behavior a -> Stream (Time, a)
reactimateB delay dt g = Next Nothing (h g)
  where h g = do timeout delay
                 ifAliveM
                 (a, g') <- liftIO $ (runReaderT $ runSignal g) dt 
                 return $ Next (Just (dt, a)) (h g')

-- convert event of batches into event of samples
unbatch :: Event [a] -> Event a
unbatch eb = Signal $ do
     ((dt, b), eb') <- runSignal eb
     h dt b eb'
  where h _ [] eb' = runSignal $ unbatch eb'
        h dt (a:b) eb' = return ((dt, a), Signal $ h dt b eb') 

-- convert behavior to event of batches of provided size and delta-time
batch :: Time -> Int -> Behavior a -> Event [a]
batch dt size g = Signal $ h [] size g
  where h b n g
         | n <= 0 = return ((dt, b), batch dt size g)
         | otherwise = do (a, g') <- (runReaderT $ runSignal g) dt
                          h (b++[a]) (n-1) g'

-- factor >= 1
upsample :: Int -> Behavior a -> Behavior [a]
upsample factor b = Signal $ ReaderT $ \t -> 
  do (a, b') <- runReaderT (runSignal b) (factor * t)
     return $ (take factor $ repeat a, upsample factor b')

-- downsample a behavior with a summary function
-- since dt is Int, downsampling factor may not be greater than dt
downsample :: Int -> ([(Int, a)] -> a) -> Behavior a -> Behavior a
downsample factor summary b = Signal $ ReaderT $ \t -> 
  let t' = if t <= factor then 1 else t `div` factor 
      h 0 lst b = return (summary lst, downsample factor summary b)
      h n lst b = do (a, b') <- runReaderT (runSignal b) t'
                     h (n-1) ((t',a):lst) b' 
  in h factor [] b   

-- Do NOT unbatch windowed data since the sampling time is dt*stride.
-- convert a behavior into event of sample windows of specified size, stride, and sample delta-time
-- resulting delta-time is 't * stride'
window :: Int -> Int -> Time -> Behavior a -> Event [a]
window size stride t b = Signal $ init size [] b
  where init 0 lst b = step 0 lst b
        init s lst b = do (a, b') <- (runReaderT $ runSignal b) t
                          init (s-1) (lst++[a]) b'
        step 0 lst b = return ((t*stride, lst), Signal $ step stride lst b)
        step d lst b = do (a, b') <- (runReaderT $ runSignal b) t
                          step (d-1) (tail lst ++ [a]) b'


