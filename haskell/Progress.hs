
module Progress
 (
   Progress (..)
 , nilP
 , consP
 , cancelP
 , isAliveP
 , ifAliveP
 , tailP
 ) where

import Control.Concurrent (putMVar, tryPutMVar, newEmptyMVar, isEmptyMVar, MVar(..))
import Control.Monad (when)

data Progress = NilP (MVar ())
              | ConsP (MVar()) Progress

nilP :: IO Progress
nilP = pure NilP <*> newEmptyMVar 

consP :: Progress -> IO Progress
consP p = do v <- newEmptyMVar
             return $ ConsP v p

tailP (NilP v) = NilP v
tailP (ConsP _ p) = p

cancelP :: Progress -> IO Bool
cancelP (NilP v) = tryPutMVar v ()
cancelP (ConsP v _) = tryPutMVar v ()

isAliveP :: Progress -> IO Bool
isAliveP (NilP v) = isEmptyMVar v
isAliveP (ConsP v p) = do b <- isEmptyMVar v 
                          if b then isAliveP p
                               else return False

ifAliveP :: Progress -> IO () -> IO ()
ifAliveP p a = do b <- isAliveP p
                  if b then a else return ()


