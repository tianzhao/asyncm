module Stream where
  
import Prelude
import Effect (Effect)
import Effect.Class (liftEffect)
import Data.Either (Either(..), either)
import Data.Int (toNumber)
import Data.Maybe (Maybe(..), fromJust, maybe)
import Data.Tuple (Tuple(..), fst)
import Data.List.Lazy (List, iterate, uncons)
import Queue as Q
import Partial.Unsafe (unsafePartial)

import AsyncM (AsyncM, Emitter, allM, anyM, asyncM, cancelM, emit, forkM, ifAliveM, listen, neverM, newEmitter_, runM_, scopeM, spawnM, timeout, unscopeM)
import Progress (Progress, cancelP)

type DTime = Int
type AStream a = AsyncM (Stream a)

data Stream a = End (Maybe a) | Next (Maybe a) (AsyncM (Stream a))

runSM :: forall a. Stream a -> (a -> Effect Unit) -> AsyncM Unit
runSM (End Nothing) _  = pure unit
runSM (End (Just x)) k = ifAliveM *> liftEffect (k x)
runSM (Next a ms) k    = do ifAliveM
                            liftEffect $ maybe (pure unit) k a
                            ms >>= flip runSM k

runS :: forall a. Stream a -> (a -> Effect Unit) -> Effect Unit
runS s k = runM_ (runSM s k) pure

runS' :: forall a. Stream a -> (a -> Effect Unit) -> Effect Unit
runS' s k = runM_ (runSM s k *> cancelM) pure


instance functorStream :: Functor Stream where
  map f (End ma)     = End (map f ma)
  map f (Next ma as) = Next (map f ma) (map (\s -> map f s) as)

instance applyStream :: Apply Stream where
  apply mf ma = do f <- mf
                   a <- ma
                   pure (f a)


instance appliciativeStream :: Applicative Stream where
  pure a = Next (Just a) neverM

instance bindStream :: Bind Stream where
  bind s f = joinS (map f s)


joinS :: forall a. Stream (Stream a) -> Stream a
joinS (End Nothing)       = End Nothing
joinS (End (Just s))      = s
joinS (Next Nothing mss)  = Next Nothing (map joinS mss)
joinS (Next (Just s) mss) = switchS s mss


switchS :: forall a. Stream a -> AsyncM (Stream (Stream a)) -> Stream a
switchS (End a) mss     = Next a (map joinS mss)
switchS (Next a ms) mss = Next a (h ms =<< spawnM mss)
  where h ms mss = do
          r <- anyM mss (unscopeM ms)
          pure $ case r of Left ss            -> joinS ss
                           Right (End a)      -> Next a (map joinS mss)
                           Right (Next a ms') -> Next a (h ms' mss)


concatS :: forall a. Stream a -> Stream a -> Stream a
concatS (End a)    s = Next a (pure s)
concatS (Next a m) s = Next a ((\s' -> concatS s' s) <$> m)

liftS :: forall a. AsyncM a -> Stream a
liftS m = Next Nothing (pure <$> m)


first :: forall a. Stream a -> Stream a
first (End x) = End x
first (Next Nothing ms) = Next Nothing (first <$> ms)
first (Next (Just x) _) = End (Just x)

leftApp :: forall a b. Stream (a -> b) -> Stream a -> Stream b
leftApp sf sx = sf <*> first sx

interval :: Int -> Int -> Stream Int
interval dt n = Next Nothing (timeout 1 *> h 1)
    where h x
            | x >= n    = pure (End (Just x))
            | otherwise = ifAliveM *> pure (Next (Just x) (timeout dt *> h (x+1)))

broadcast' :: forall a. Stream a -> AsyncM (Tuple (Emitter a) Progress)
broadcast' s = do
    e <- liftEffect newEmitter_
    p <- forkM $ runSM s (emit e)
    pure $ Tuple e p

broadcast :: forall a. Stream a -> AsyncM (Emitter a)
broadcast s = fst <$> broadcast' s

receive :: forall a. Emitter a -> Stream a
receive e = Next Nothing h
    where h = do a <- listen e
                 ifAliveM
                 pure $ Next (Just a) h

multicast' :: forall a. Stream a -> Stream (Tuple (Stream a) Progress)
multicast' s = Nothing `Next` do (Tuple e p) <- broadcast' s
                                 pure $ pure (Tuple (receive e) p)

multicast :: forall a. Stream a -> Stream (Stream a)
multicast s = fst <$> multicast' s 


appS :: forall a b. Stream (a -> b) -> Stream a -> Stream b
appS (End f) (End x)           = End  (f <*> x)
appS (End f) (Next x msx)      = Next (f <*> x) (appS (End f) <$> msx)
appS (Next f msf) (End x)      = Next (f <*> x) (flip appS (End x) <$> msf)
appS (Next f msf) (Next x msx) = Next (f <*> x) m
    where m = do mf <- spawnM msf
                 mx <- spawnM msx
                 anyM mf mx >>= either (\sf -> pure $ appS sf $ Next x mx)
                                       (\sx -> pure $ appS (Next f mf) sx)


mergeS :: forall a. Stream a -> Stream a -> Stream a
mergeS (End a) (End b)         = Next a (pure $ End b)
mergeS (End a) s               = Next a $ pure s
mergeS (Next a msa) (End b)    = Next a $ pure (Next b msa)
mergeS (Next a ma) (Next b mb) = Next a $ pure (Next b $ h ma mb)
  where h ma mb = do ma' <- spawnM ma
                     mb' <- spawnM mb
                     anyM ma' mb' >>= either (unsafePartial (\(Next a ma) -> pure $ Next a $ h ma mb'))
                                             (unsafePartial (\(Next b mb) -> pure $ Next b $ h ma' mb))


zipS :: forall a b. Stream a -> Stream b -> Stream (Tuple a b)
zipS (End a1) (End a2)           = End (Tuple <$> a1 <*> a2)
zipS (End a1) (Next a2 ms2)      = End (Tuple <$> a1 <*> a2)
zipS (Next a1 ms1) (End a2)      = End (Tuple <$> a1 <*> a2)
zipS (Next a1 ms1) (Next a2 ms2) = Next (Tuple <$> a1 <*> a2) ms
  where ms = do (Tuple s1 s2) <- allM ms1 ms2
                ifAliveM
                pure $ zipS s1 s2

repeatS :: forall a. AsyncM a -> Stream a
repeatS m = Next Nothing (repeatA m)

repeatA :: forall a. AsyncM a -> AStream a
repeatA m = do a <- m
               ifAliveM
               pure $ Next (Just a) (repeatA m)

foreverS :: Int -> Stream Unit
foreverS dt = repeatS $ timeout dt

fromList :: forall a. List a -> Stream a
fromList lst = h (uncons lst)
    where h Nothing  = End Nothing
          h (Just l) = Next (Just l.head) (pure $ fromList l.tail)

zipWithIndex :: forall a. Stream a -> Stream (Tuple Int a)
zipWithIndex s = zipS (fromList $ iterate (1 + _) 1) s

-- get rid of Nothing except possibly the first one
justS :: forall a. Stream a -> Stream a
justS (End a)     = End a
justS (Next a ms) = Next a (ms >>= h)
  where h (Next Nothing ms)  = ms >>= h
        h (Next (Just x) ms) = pure $ Next (Just x) (ms >>= h)
        h (End a)            = pure $ End a

-- take the first n events. If n <= 0, then nothing
-- if 's' has less than n events, the 'takeS n s' emits all events of s
takeS :: forall a. Int -> Stream a -> Stream a
takeS n s
    | n <= 0    = End Nothing
    | otherwise = f n s
  where f 1 (Next (Just x) _) = End (Just x)
        f n (Next a ms) = Next a $ takeS (maybe n (\_->n-1) a) <$> ms
        f _ (End a) = End a

-- explicitly cancel a stream after it reaches the 'End'
endS :: forall a. Stream a -> Stream a
endS (End a)     = End a
endS (Next a ms) = Next a $ scopeM $ f ms
  where f m = do s <- m
                 case s of End a -> cancelM *> pure (End a) 
                           Next a m' -> pure $ Next a $ f m'

-- take n events from s and cancel s explicitly
takeS_ :: forall a. Int -> Stream a -> Stream a
takeS_ n s = endS $ takeS n s

-- drop the first n events
-- if 's' has less than n events, then 'dropS s' never starts.
dropS :: forall a. Int -> Stream a -> Stream a
dropS n s = justS (h n s)
  where h n s | n <= 0    = s 
              | otherwise = case s of End _ -> End Nothing
                                      Next _ ms -> Next Nothing (h (n-1) <$> ms)

-- wait dt milliseconds and then start 's'
waitS :: forall a. DTime -> Stream a -> Stream a
waitS dt s = Next Nothing (timeout dt *> pure s)

-- skip the events of the first dt milliseconds  
skipS :: forall a. DTime -> Stream a -> Stream a
skipS dt s = multicast s >>= waitS dt

-- delay each event of 's' by dt milliseconds
delayS :: forall a. DTime -> Stream a -> Stream a
delayS dt s = Next Nothing (h s)
  where h (Next a ms) = timeout dt *> (pure $ Next a (ms >>= h))
        h (End a)     = timeout dt *> (pure $ End a)

-- stop 's' after dt milliseconds
stopS :: forall a. DTime -> Stream a -> Stream a
stopS _ (End a) = End a
stopS dt s      = s `switchS` (timeout dt *> pure (End Nothing))

-- start the first index after dt
interval' :: Int -> Int -> Stream Int
interval' dt n = takeS n $ map fst $ zipWithIndex $ foreverS dt

-----------------------------------------------------------------------

-- fold the functions emitted from s with the initial value a
accumulate :: forall a. a -> Stream (a -> a) -> Stream a
accumulate a (End f)     = End (Just $ maybe a (_ $ a) f) 
accumulate a (Next f ms) = let a' = maybe a (_ $ a) f  
                           in Next (Just a') (accumulate a' <$> ms)


lastS :: forall a. Stream a -> AsyncM Unit -> AsyncM (Maybe a)
lastS s m = spawnM m >>= flip h s
  where h m (Next a ms) = anyM ms m >>= either (h m) (const $ pure a) 
        h m (End a)     = m *> pure a

-- fold the functions emitted from s for n milli-second with the initial value c 
foldS :: forall a. DTime -> a -> Stream (a -> a) -> AsyncM a
foldS n c s = unsafePartial $ fromJust <$> lastS (accumulate c s) (timeout n) 

-- emit the number of events of s for every n milli-second
countS :: forall a. DTime -> Stream a -> AsyncM Int
countS n s = foldS n 0 $ (1 + _) <$ s 

-- run s until ms occurs and then runs the stream in ms
untilS :: forall a. Stream a -> AStream a -> Stream a
untilS s ms = joinS $ Next (Just s) (pure <$> ms)

-----------------------------------------------------------------------



-----------------------------------------------------------------------
-- fetch data by sending requests as a stream of AsyncM and return the results in a stream
fetchS :: forall a. Stream (AsyncM a) -> Stream a
fetchS sm = Next Nothing $ do c <- liftEffect Q.new
                              void (forkM (runSM (liftS <<< spawnM =<< sm) (Q.put c)))
                              repeatA $ join $ (asyncM $ \p k -> Q.once c (k <<< Right))

-- measure the data speed = total sample time / system time
speedS :: forall a. DTime -> Stream (Tuple DTime a) -> AsyncM Number
speedS n s = f <$> (foldS n 0 $ (\(Tuple dt _) t -> t + dt) <$> s)
  where f t = toNumber t / toNumber n

-- call f to request samples with 'dt' interval and 'delay' between requests
requestS :: forall a. (DTime -> AsyncM a) -> DTime -> DTime -> Stream (Tuple DTime a)
requestS f dt delay = Tuple dt <$> s
  where s = fetchS $ f dt <$ foreverS delay

controlS :: forall t a. (t -> Stream (AsyncM a)) -> Int -> t -> (Boolean -> t -> t) -> Stream (Tuple t a) 
controlS req_fun duration dt adjust = join $ h dt  
  where h dt = do (Tuple request  p1) <- multicast' $ req_fun dt 
                  (Tuple response p2) <- multicast' $ fetchS request 
     
                  let mss = do timeout duration 
                               (Tuple x y) <- allM (countS duration response)
                                              (countS duration request)
                               if x == y then mss
                               else do void $ liftEffect $ cancelP p1 *> cancelP p2
                                       pure $ h $ adjust (x < y) dt 
                  Just (Tuple dt <$> response) `Next` mss

-----------------------------------------------------------------------



