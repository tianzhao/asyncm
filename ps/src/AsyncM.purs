module AsyncM where

import Prelude

import Effect (Effect)
import Effect.Class (class MonadEffect)
import Effect.AVar (AVar, empty, isEmpty, new, put, status, take, tryPut, tryRead)
import Effect.Console (log)
import Effect.Exception (throwException)
import Effect.Timer (setTimeout)
import Control.Apply (lift2)
import Data.Either (Either(..), either)
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Data.Traversable (for_)
import Data.List (List(..), (:))
import Partial.Unsafe (unsafePartial)

import Progress (Progress, cancelP, consP, ifAliveP, nilP, tailP)


newtype AsyncM a = AsyncM { run :: Progress -> (Either String a -> Effect Unit) -> Effect Unit }

asyncM :: forall a. (Progress -> (Either String a -> Effect Unit) -> Effect Unit) -> AsyncM a
asyncM h = AsyncM { run: h }

runM :: forall a. AsyncM a -> Progress -> (Either String a -> Effect Unit) -> Effect Unit
runM (AsyncM m) = m.run

runM_ :: forall a. AsyncM a -> (a -> Effect Unit) -> Effect Unit
runM_ a k = nilP >>= \p -> runM a p (either log k)

instance functorAsyncM :: Functor AsyncM where
  map f m = asyncM $ \p k -> runM m p (\x -> k (f <$> x))

instance applyAsyncM :: Apply AsyncM where
  apply mf ma = do f <- mf
                   a <- ma
                   pure (f a)

instance appAsyncM :: Applicative AsyncM where
    pure a = asyncM $ \p k -> k (Right a)

instance bindAsyncM :: Bind AsyncM where
    bind m f = asyncM $ \p k -> runM m p (either (k <<< Left) (\x -> runM (f x) p k))

instance monadAsyncM :: Monad AsyncM

-- TODO catch error
instance monadEffectAsyncM :: MonadEffect AsyncM where
    liftEffect m = asyncM $ \p k -> k <<< Right =<< m


joinM :: forall a. AsyncM (AsyncM a) -> AsyncM a
joinM m = m >>= identity


neverM :: forall a. AsyncM a
neverM = asyncM (\_ _ -> pure unit)

forkM :: forall a. AsyncM a -> AsyncM Progress
forkM a = asyncM $ \p k -> do p' <- consP p
                              runM a p' $ const (pure unit)
                              k $ Right p'

----------------------------------

swapAVar :: forall a. a -> AVar a -> Effect a
swapAVar x v = unsafePartial $ do
    ret <- empty
    _ <- take v (either (const $ pure unit) (\y -> do _ <- tryPut y ret
                                                      _ <- tryPut x v
                                                      pure unit))
    (Just b) <- tryRead ret
    pure b


----------------------------------

data Emitter a = Emitter (AVar a) (AVar (List (a -> Effect Unit)))

newEmitter_ :: forall a. Effect (Emitter a)
newEmitter_ = Emitter <$> empty <*> new Nil

emit :: forall a. Emitter a -> a -> Effect Unit
emit (Emitter av kv) a = do
    void $ take av (const (pure unit))
    void $ put a av (const (pure unit))
    lst <- swapAVar Nil kv
    for_ lst $ \k -> k a

listen :: forall a. Emitter a -> AsyncM a
listen (Emitter _ kv) = asyncM $ \_ k -> do
    void $ take kv $ either throwException $ \lst -> void (tryPut ((k <<< Right) : lst) kv)


spawnM :: forall a. AsyncM a -> AsyncM (AsyncM a)
spawnM m = asyncM $ \p k -> do
    e <- newEmitter_
    runM m p (either (\_ -> pure unit) (emit e))
    k $ Right $ waitE e

waitE :: forall a. Emitter a -> AsyncM a
waitE (Emitter av kv) = asyncM $ \p k -> do
    a <- tryRead av
    case a of Just x  -> k (Right x)
              Nothing -> runM (listen (Emitter av kv)) p k

-------

scopeM :: forall a. AsyncM a -> AsyncM a
scopeM m = asyncM $ \p k -> do
    p' <- consP p
    runM m p' $ either (\e -> cancelP p' *> k (Left e)) (k <<< Right)

unscopeM :: forall a. AsyncM a -> AsyncM a
unscopeM m = asyncM $ \p k -> runM m (tailP p) k

ifAliveM :: AsyncM Unit
ifAliveM = asyncM $ \p k -> ifAliveP p (k $ Right unit)

commitM :: AsyncM Unit
commitM = ifAliveM *> cancelM

cancelM :: AsyncM Unit
cancelM = asyncM $ \p k -> do
    b <- cancelP p
    if b then k (Right unit) else pure unit


raceM :: forall a. AsyncM a -> AsyncM a -> AsyncM a
raceM m1 m2 = scopeM $ asyncM (\p k -> runM m1 p k *> runM m2 p k)


anyM :: forall a b. AsyncM a -> AsyncM b -> AsyncM (Either a b)
anyM m1 m2 = raceM (Left <$> m1 <* commitM) (Right <$> m2 <* commitM)

allM :: forall a b. AsyncM a -> AsyncM b -> AsyncM (Tuple a b)
allM m1 m2 = asyncM $ \p k -> do
    v1 <- empty
    v2 <- empty
    -- couldn't infer the correct type
    let k' :: forall r q.
               AVar (Either String r)
            -> AVar (Either String q)
            -> (Either String r -> Either String q -> Either String (Tuple a b))
            -> Either String r
            -> Effect Unit
        k' v1' v2' fpair = \x -> do
            b <- status v2'
            if isEmpty b
            then do _ <- tryPut x v1'
                    case x of Left e  -> k (Left e)
                              Right _ -> pure unit
            else do my <- tryRead v2'
                    case my of Nothing -> pure unit    -- FIXME!
                               Just (Left _) -> pure unit
                               Just y@(Right _) -> k (fpair x y)

    runM m1 p (k' v1 v2 pair)
    runM m2 p (k' v2 v1 $ flip pair)
    where pair = lift2 Tuple

-- todo: cancel timer
timeout :: Int -> AsyncM Unit
timeout ms = asyncM $ \p k -> void $ setTimeout ms (k (Right unit))



