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
      test = s45

  run test (aprint . (">> " <>) . show)

---------------------------------------------------------------------------


s22 = minChangeInterval 10 $ interval 100 10

s23 = sampleInterval 200 $ interval_ 100 20

s33 = interval_ 100 30

s34 = delayS_ 800 $ fromList [(*2), (*10)]

s35 = justS $ concatS (pure (*2)) (delayS 800 (pure (*10)))

s36 = concatS (pure (*2)) (delayS 800 (pure (*10)))

s30 = s36 <*> s33

--s36 = delayS_ 800 $ fromList [fmap (*2), fmap (*10)]

s41 = switchMap s43 s33

s43 = delayS_ 500 $ fromList [fmap (*2), id, fmap (*10)]

s44 = delayS_ 500 $ fromList [10, 11, 12]

s45 = do 
  sf' <- multicast s44
  sf'

switchMap :: Stream (Stream a -> Stream a) -> Stream a -> Stream a
switchMap sf sa = do
  sf' <- multicast sf
  sa' <- multicast sa
  let h (End f)      = mf f sa'
      h (Next f msf) = mf f sa' `untilS` (return . h =<< msf)
  h sf'
  where mf = maybe nothingS id


nothingS (End _)     = End Nothing
nothingS (Next _ ms) = Next Nothing (nothingS <$> ms)

