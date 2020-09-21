{-# LANGUAGE GeneralizedNewtypeDeriving #-}

module AsyncM 
  (
    AsyncM (..)
  , runM        -- run asyncM
  , runM_       -- run asyncM with a new progress and print exception 
  , timeout
  , forkM
  , raceM
  , allM
  , ifAliveM
  , advM
  , cancelM
  , commitM
  , neverM
  , asyncM
  , scopeM
  , unscopeM
  , anyM
  ) where

import Control.Concurrent (threadDelay, readMVar, putMVar, newEmptyMVar, isEmptyMVar, MVar(..))
import Control.Concurrent.Async (async)
import Control.Monad.Cont (runContT, ContT(..))
import Control.Monad.Except (catchError, ExceptT(..), MonadError(..), runExceptT)
import Control.Monad.Reader (ask, local, ReaderT(..), MonadReader(..), runReaderT)
import Control.Monad.IO.Class (MonadIO(..))
import Control.Exception (catch, displayException, SomeException(..))
import Progress

-- Progress -> (Either String a -> IO ()) -> IO ()
newtype AsyncM a = AsyncM { runAsyncM :: ExceptT String (ReaderT Progress (ContT () IO)) a } 
                     deriving (Functor, Applicative, Monad, MonadIO, MonadReader Progress, MonadError String) 

runM :: AsyncM a -> Progress -> (Either String a -> IO ()) -> IO ()
runM (AsyncM a) p k = runContT (runReaderT (runExceptT a) p) k

runM_ :: AsyncM a -> (a -> IO ()) -> IO ()
runM_ a k = nilP >>= \p -> runM a p (either print k)

asyncM f =  AsyncM $ ExceptT $ ReaderT $ \p -> ContT $ \k -> f p k 

timeout :: Int        -- number milliseconds
        -> AsyncM () 
timeout x = asyncM $ \p k -> do async $ threadDelay (x*10^3) >> k (Right ()) 
                                return ()
                                `catch` \(SomeException e) -> k (Left $ displayException e)

interval :: Int            -- number of events
         -> Int            -- milliseconds between events
         -> (Int -> IO ()) -- function to consume event index
         -> AsyncM ()
interval n dt k = f 1
  where f i = do ifAliveM
                 if i > n then return ()
                 else do timeout dt 
                         liftIO $ k i
                         f (i+1) 

neverM :: AsyncM a
neverM =  asyncM $ \_ _ -> return ()

catchM :: AsyncM a -> (String -> AsyncM a) -> AsyncM a
catchM = catchError 

forkM :: AsyncM a -> AsyncM Progress
forkM a = asyncM $ \p k -> do p' <- consP p
                              runM a p' $ \_ -> return () -- exception of 'a' is ignored  
                              k $ Right p'

scopeM :: AsyncM a -> AsyncM a
scopeM a = asyncM $ \p k -> do p' <- consP p       -- cancel  p' for unhandled exception
                               let k' = either (\e -> cancelP p' >> k (Left e)) (k . Right) 
                               runM a p' k'

unscopeM :: AsyncM a -> AsyncM a
unscopeM a = local f a
  where f (ConsP _ p) = p; f p = p

raceM :: AsyncM a -> AsyncM a -> AsyncM a
raceM a1 a2 = scopeM $ asyncM $ \p k -> runM a1 p k >> runM a2 p k
 
-- more like 'race' in Haskell Async library
anyM :: AsyncM a -> AsyncM b -> AsyncM (Either a b)
anyM a1 a2 = raceM (Left <$> a1 <* commitM) (Right <$> a2 <* commitM)

-- if a1 throws an exception e, then completes with e
-- if a2 throws an exception e, then completes with e
-- if a1 finishes first, then wait for a2
-- if a2 finishes first, then wait for a1
allM :: AsyncM a -> AsyncM b -> AsyncM (a, b)
allM a1 a2 = asyncM $ \p k -> do 
    m1 <- newEmptyMVar
    m2 <- newEmptyMVar

    let k' m1 m2 pair = \x -> do b <- isEmptyMVar m2
                                 if b then do putMVar m1 x
                                              case x of Left e -> k (Left e) 
                                                        Right _ -> return ()
                                      else do y <- readMVar m2
                                              case y of Left e -> return ()
                                                        Right _ -> k $ pair x y
    runM a1 p (k' m1 m2 pair)
    runM a2 p (k' m2 m1 $ flip pair) 

    where pair x y = pure (,) <*> x <*> y


-- if p is not cancelled, then cancel it and return ()
-- otherwise, do nothing (i.e. terminate)
cancelM :: AsyncM ()
cancelM = asyncM $ \p k -> do b <- cancelP p 
                              if b then k (Right ()) else return () 

ifAliveM :: AsyncM ()
ifAliveM = asyncM $ \p k -> ifAliveP p $ k $ Right ()

commitM :: AsyncM ()
commitM = ifAliveM >> cancelM

-- advance the current ConsP progress object
-- do nothing if the progress object is NilP
advM :: AsyncM a -> AsyncM a
advM a = commitM >> unscopeM a

