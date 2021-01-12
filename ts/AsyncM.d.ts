export { AsyncM, Stream, Progress, Behavior, Signal, Duration, stepper, unbatch, combineLatest };
declare type Unit = void;
declare type Func<A, B> = (a: A) => B;
declare type Duration = number;
declare type MaybeAppResult<T, A> = T extends Func<A, infer B> ? Maybe<B> : never;
declare type AsyncMAppResult<T, A> = T extends Func<A, infer B> ? AsyncM<B> : never;
declare type AsyncMJoinResult<T> = T extends AsyncM<infer R> ? AsyncM<R> : never;
declare type StreamAppResult<T, A> = T extends Func<A, infer B> ? Stream<B> : never;
declare type StreamJoinResult<T> = T extends Stream<infer R> ? Stream<R> : never;
declare type SignalAppResult<T, A> = T extends Func<A, infer B> ? Signal<B> : never;
declare type BehaviorAppResult<T, A> = T extends Func<A, infer B> ? Behavior<B> : never;
declare abstract class Maybe<T> {
    abstract maybe<B>(def: B): (f: (a: T) => B) => B;
    abstract fromJust(): T;
    abstract isNothing(): boolean;
    abstract fmap<B>(f: (a: T) => B): Maybe<B>;
    abstract app<A>(mx: Maybe<A>): MaybeAppResult<T, A>;
    static nothing: Nothing<any>;
    static just<T>(val: T): Just<T>;
    static pair: <T1>(a: Maybe<T1>) => <T2>(b: Maybe<T2>) => Maybe<[T1, T2]>;
}
declare class Nothing<T> extends Maybe<T> {
    maybe<B>(def: B): () => B;
    fromJust(): never;
    isNothing(): boolean;
    fmap<B>(f: (a: T) => B): Nothing<B>;
    app<A>(_: Maybe<A>): MaybeAppResult<T, A>;
}
declare class Just<T> extends Maybe<T> {
    value: T;
    constructor(value: T);
    maybe<B>(_: B): (f: (a: T) => B) => B;
    fromJust(): T;
    isNothing(): boolean;
    fmap<B>(f: (a: T) => B): Just<B>;
    app<A, B>(maybeX: Maybe<A>): MaybeAppResult<T, A>;
}
declare abstract class Either<A, B> {
    abstract either<C>(l: (a: A) => C): (r: (b: B) => C) => C;
    static left<A, B>(x: A): Either<A, B>;
    static right<A, B>(x: B): Either<A, B>;
}
declare abstract class Progress {
    head: boolean;
    constructor();
    static nil(): NilP;
    cons(): ConsP;
    cancelP(): boolean;
    abstract isAliveP(): boolean;
}
declare class ConsP extends Progress {
    tail: Progress;
    constructor(tail: Progress);
    isAliveP(): boolean;
}
declare class NilP extends Progress {
    isAliveP(): boolean;
}
declare class AsyncM<T> {
    _run: (p: Progress) => Promise<T>;
    run(p?: Progress): Promise<T>;
    constructor(run: (p: Progress) => Promise<T>);
    fmap<R>(f: (a: T) => R): AsyncM<R>;
    static pure<R>(x: R): AsyncM<R>;
    bind<R>(f: (a: T) => AsyncM<R>): AsyncM<R>;
    join(): AsyncMJoinResult<T>;
    app<A>(mx: AsyncM<A>): AsyncMAppResult<T, A>;
    spawn(): SpawnM<AsyncM<T>>;
    fork(): AsyncM<Progress>;
    scope(): AsyncM<T>;
    unscope(): AsyncM<T>;
    liftS(): Stream<T>;
    repeatS(): Stream<T>;
    repeatA(): AsyncM<Stream<T>>;
    static liftIO<R>(io: (k: (a: R | PromiseLike<R>) => void) => void): AsyncM<R>;
    static liftIO_<R>(io: Promise<R>): AsyncM<R>;
    static never: AsyncM<never>;
    static timeout(n: Duration): AsyncM<void>;
    static cancel: AsyncM<Unit>;
    static ifAlive: AsyncM<Unit>;
    static commit: AsyncM<Unit>;
    static race: <A>(m1: AsyncM<A>) => (m2: AsyncM<A>) => AsyncM<A>;
    static any: <A>(m1: AsyncM<A>) => <B>(m2: AsyncM<B>) => AsyncM<Either<A, B>>;
    static all: <A>(m1: AsyncM<A>) => <B>(m2: AsyncM<B>) => AsyncM<[A, B]>;
    static interval<A>(n: number, dt: number, f: (a: number) => A): AsyncM<A | void>;
}
declare class SpawnM<A> extends AsyncM<A> {
    spawn(): SpawnM<AsyncM<A>>;
}
declare class Emitter<T> {
    now: T | undefined;
    listeners: Array<(a: T) => void>;
    constructor();
    emit(x: T): void;
    listen(): AsyncM<T>;
    wait(): AsyncM<T>;
    receive(): Stream<T>;
}
declare abstract class Stream<T> {
    maybe_a: Maybe<T>;
    constructor(a: Maybe<T>);
    abstract match<R>(fEnd: (a: Maybe<T>) => R): (fNext: (a: Maybe<T>, b: AsyncM<Stream<T>>) => R) => R;
    run(k: (a: T) => void): AsyncM<void>;
    fmap<R>(f: (a: T) => R): Stream<R>;
    app<A>(sx: Stream<A>): StreamAppResult<T, A>;
    bind<R>(k: (a: T) => Stream<R>): Stream<R>;
    join(): StreamJoinResult<T>;
    switchS(mss: AsyncM<Stream<Stream<T>>>): Stream<T>;
    leftApp<A>(sx: Stream<A>): StreamAppResult<T, A>;
    broadcast(): AsyncM<[Emitter<T>, Progress]>;
    multicast_(): Stream<[Stream<T>, Progress]>;
    multicast(): Stream<Stream<T>>;
    zip<R>(that: Stream<R>): Stream<[T, R]>;
    zipWithIndex(i: number): Stream<[number, T]>;
    end(): Stream<T>;
    take(n: number): Stream<T>;
    take_(n: number): Stream<T>;
    drop(n: number): Stream<T>;
    just(): Stream<T>;
    wait(dt: number): Stream<T>;
    skip(dt: number): Stream<T>;
    delay(dt: number): Stream<T>;
    stop(dt: number): Stream<T>;
    accumulate<A>(a0: A): Stream<A>;
    last(m: AsyncM<any>): AsyncM<Maybe<T>>;
    fold(n: number): <A>(c: A) => AsyncM<A>;
    count(n: number): AsyncM<number>;
    until(ms: AsyncM<Stream<any>>): Stream<T>;
    static fetch<A>(s: Stream<AsyncM<A>>): Stream<A>;
    fetch<A>(): T extends AsyncM<A> ? Stream<A> : never;
    speed(n: number): AsyncM<number>;
    speedControl(duration: Duration): (f: Func<number, number>) => AsyncM<boolean>;
    push2pull(): AsyncM<Signal<T>>;
    fetchG(): AsyncM<Signal<T>>;
    static next: <A>(a: Maybe<A>, m: AsyncM<Stream<A>>) => Stream<A>;
    static end: <A>(a: Maybe<A>) => Stream<A>;
    static pure: <A>(x: A) => Stream<A>;
    static interval: (dt: Duration, n: number) => Stream<number>;
    static interval_: (dt: Duration, n: number) => Stream<number>;
    static forever: (dt: Duration) => Stream<Unit>;
    static fromList: <T_1>(lst: T_1[]) => Stream<T_1>;
    static request: <A>(async_fun: Func<number, AsyncM<A>>) => (dt: Duration) => (delay: Duration) => Stream<[number, A]>;
    static control: <A>(req_fun: Func<number, Stream<AsyncM<A>>>) => (duration: Duration) => (dt: Duration) => (adjust: Func<boolean, Func<Duration, Duration>>) => Stream<[number, A]>;
    static fetchE: <A>(req_fun: Func<number, Stream<AsyncM<A>>>) => (dt: Duration) => AsyncM<Signal<unknown[]>>;
}
declare function combineLatest<T, R>(sf: Stream<Func<T, R>>, sx: Stream<T>): Stream<R>;
declare class Signal<T> {
    run: () => Promise<T>;
    constructor(run: () => Promise<T>);
    static pure: <T_1>(a: T_1) => Signal<T_1>;
    fmap<R>(f: (a: T) => R): Signal<R>;
    app<A>(gx: Signal<A>): SignalAppResult<T, A>;
    reactimate(delay: number): Stream<T>;
}
declare function stepper<A>(s: Signal<[Duration, A]>, summary: Func<[Duration, A][], A>): Behavior<A>;
declare function unbatch<A>(s: Signal<[Duration, A[]]>): Signal<[Duration, A]>;
declare class Behavior<T> {
    run: (time: number) => Promise<T>;
    constructor(run: (time: number) => Promise<T>);
    static pure: <T_1>(a: T_1) => Behavior<T_1>;
    fmap<R>(f: (a: T) => R): Behavior<R>;
    app<A>(bx: Behavior<A>): BehaviorAppResult<T, A>;
    reactimate(delay: Duration): (dt: Duration) => Stream<[Duration, T]>;
    batch(dt: Duration): (size: number) => Signal<[Duration, T[]]>;
    upsample(factor: number): Behavior<T[]>;
    downsample(factor: number): (summary: (a: [number, T][]) => T) => Behavior<T>;
    windowing(size: number): (stride: number) => (dt: number) => Signal<[number, T[]]>;
}
