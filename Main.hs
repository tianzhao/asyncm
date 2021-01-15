module Main where

import Control.Concurrent (newMVar, MVar, withMVar)
import Control.Monad.Cont (liftIO)
import Control.Monad (join)


import AsyncM
import Progress
import Stream


main = do
  lock <- newMVar ()
  let aprint :: Show a => a -> IO ()
      aprint = withMVar lock . const . print

      --test = takeS 20 s23
      test = s41

  run test (aprint . (">> " <>) . show)

---------------------------------------------------------------------------


s22 = minChangeInterval 10 $ interval 100 10

s23 = sampleInterval 200 $ interval_ 100 20

s33 = interval_ 100 100

s34 = delayS_ 800 $ fromList [(*2), (*10)]

s35 = justS $ concatS (pure (*2)) (delayS 800 (pure (*10)))

s36 = concatS (pure (*2)) (delayS 800 (pure (*10)))

s30 = s36 <*> s33


s41 = switchMap s43' s33

s43 :: Stream (Stream Int -> Stream Int)
s43 = delayS_ 500 $ fromList [fmap (*2), id, fmap (*10)]

s43' :: Stream (Stream Int -> Stream (Int, Int))
s43' = delayS 500 $ fromList [fmap (\x -> (2, x*2)), fmap (\x -> (1, x)), fmap (\x -> (10, x*10))]

s44 = delayS_ 500 $ fromList [10, 11, 12]

s45 = do 
  sf' <- multicast s44
  sf'

s46 = fromDelayedList [(0,0), (100, 100), (2000, 500), (3000, 50), (1000, 75)]

s47 = controlS'' s33 s46

