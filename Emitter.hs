
module Emitter
  ( 
    Emitter (..)
  , newEmitter
  , emit
  , listen
  , now
  , runE
  , foldE
  , newEmitter_
  , spawnM
  , waitE
  ) where

import Control.Monad (forM_)
import Control.Monad.Cont (ContT (..), liftIO)
import Control.Concurrent (MVar (..), newMVar, swapMVar, modifyMVar_, readMVar, newEmptyMVar, tryTakeMVar, tryReadMVar, putMVar)
import AsyncM (AsyncM (..), ifAliveM, runM, asyncM)
import Progress (isAliveP)

data Emitter a = Emitter (MVar a) -- the previous event value
                         (MVar [a -> IO ()]) -- registered callback
 
-- new emitter has an initial value
-- but there is no registered callback
newEmitter a = pure Emitter <*> newMVar a <*> newMVar [] 

-- make a blank emitter
newEmitter_ = pure Emitter <*> newEmptyMVar <*> newMVar [] 

-- save 'a' as the previous event
-- emit 'a' to registered callbacks if exist
emit :: Emitter a -> a -> IO ()
emit (Emitter av kv) a = do 
    tryTakeMVar av
    putMVar av a 
    lst <- swapMVar kv []
    forM_ lst $ \k -> k a

-- TODO: need to remove callback on cancel
-- register callback 'k' on the emitter
listen :: Emitter a -> AsyncM a
listen (Emitter _ kv) = asyncM $ \_ k -> modifyMVar_ kv $ \lst -> return (k . Right : lst) 

-- check whether an event value already exists, if so, return that value
-- otherwise, listen to new event value
waitE :: Emitter a -> AsyncM a
waitE (Emitter av kv) = asyncM $ \p k -> 
             do a <- tryReadMVar av 
                case a of Just x -> (k . Right) x
                          Nothing -> modifyMVar_ kv $ \lst -> return (k . Right : take 1 lst) 
                          -- Nothing -> swapMVar kv [k . Right] >> return () 
                          -- must one 'waitE' on each 'e' at a time

-- This is blocking!
now :: Emitter a -> IO a
now (Emitter av _) = readMVar av 

runE :: Emitter a -> (a -> IO ()) -> AsyncM ()
runE e k = let h = do x <- listen e 
                      ifAliveM
                      liftIO $ k x
                      h 
           in h

foldE :: Emitter a -> (b -> a -> IO b) -> b -> AsyncM ()
foldE e f b = let h b = do a <- listen e
                           ifAliveM
                           b <- liftIO $ f b a
                           h b
              in h b
                           
-- run 'm' and put its value inside an emitter 'e', and return a new AsyncM that waits for the result in 'e'
spawnM :: AsyncM a -> AsyncM (AsyncM a)
spawnM m = asyncM $ \p k -> do
   e <- newEmitter_
   runM m p (either print $ emit e) 
   k $ Right $ waitE e

