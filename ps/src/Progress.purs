module Progress where

import Prelude

import Effect
import Effect.AVar

data Progress = NilP (AVar Unit)
              | ConsP (AVar Unit) Progress

nilP :: Effect Progress
nilP = pure <<< NilP =<< empty

consP :: Progress -> Effect Progress
consP p = do
    v <- empty
    pure (ConsP v p)

tailP :: Progress -> Progress
tailP p@(NilP _)  = p
tailP (ConsP _ p) = p

cancelP :: Progress -> Effect Boolean
cancelP (NilP v)    = tryPut unit v
cancelP (ConsP v p) = tryPut unit v

isAliveP :: Progress -> Effect Boolean
isAliveP (NilP v)    = pure <<< isEmpty =<< status v
isAliveP (ConsP v p) = do
    b <- status v
    if isEmpty b then isAliveP p else pure false

ifAliveP :: Progress -> Effect Unit -> Effect Unit
ifAliveP p a = do
    b <- isAliveP p
    if b then a else pure unit

