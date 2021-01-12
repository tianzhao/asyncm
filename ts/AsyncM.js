"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.combineLatest = exports.unbatch = exports.stepper = exports.Signal = exports.Behavior = exports.Progress = exports.Stream = exports.AsyncM = void 0;
const unit = undefined;
function isFunction(f) {
    return typeof f === "function";
}
function ensureTuple(t) {
    if (t instanceof Array)
        return t;
    throw new TypeError();
}
function ensureFunction(f) {
    if (f instanceof Function)
        return f;
    throw new TypeError();
}
function ensureAsyncM(m) {
    if (m instanceof AsyncM)
        return m;
    throw new TypeError();
}
function ensureStream(m) {
    if (m instanceof Stream)
        return m;
    throw new TypeError();
}
/*
 * Maybe type
 */
class Maybe {
    static just(val) { return new Just(val); }
}
Maybe.pair = (a) => (b) => a.fmap(x => (y) => [x, y]).app(b);
class Nothing extends Maybe {
    maybe(def) { return () => def; }
    fromJust() { throw new TypeError(); }
    isNothing() { return true; }
    fmap(f) { return this; }
    app(_) { return this; }
}
Maybe.nothing = new Nothing();
class Just extends Maybe {
    constructor(value) {
        super();
        this.value = value;
    }
    maybe(_) {
        return (f) => f(this.value);
    }
    fromJust() { return this.value; }
    isNothing() { return false; }
    fmap(f) { return new Just(f(this.value)); }
    app(maybeX) {
        if (!isFunction(this.value))
            throw new TypeError();
        return maybeX.fmap(this.value);
    }
}
/*
 * Either type
 */
class Either {
    static left(x) { return new Left(x); }
    static right(x) { return new Right(x); }
}
;
class Left extends Either {
    constructor(value) {
        super();
        this.value = value;
    }
    either(l) {
        return (_) => l(this.value);
    }
}
class Right extends Either {
    constructor(value) {
        super();
        this.value = value;
    }
    either(l) { return r => r(this.value); }
}
/*
 *  2. Progress definitions: Progress, ConsP, and NilP
 */
class Progress {
    constructor() {
        this.head = false;
    }
    static nil() { return new NilP(); }
    cons() { return new ConsP(this); }
    cancelP() {
        if (!this.head) {
            this.head = true;
            return true;
        }
        else {
            return false;
        }
    }
}
exports.Progress = Progress;
class ConsP extends Progress {
    constructor(tail) {
        super();
        this.tail = tail;
    }
    isAliveP() {
        return !this.head && this.tail.isAliveP();
    }
}
class NilP extends Progress {
    isAliveP() { return !this.head; }
}
/*
 *  3. AsyncM definitions: AsyncM, never, timeout, cancel, ifAlive, commit, race, any, all
 */
class AsyncM {
    // run :: Progress -> (a -> IO ()) -> IO ()
    // run :: Progress -> Promise a 
    constructor(run) {
        this._run = run;
    }
    run(p) {
        if (p === undefined)
            p = Progress.nil();
        return this._run(p);
    }
    // f <$> this
    fmap(f) { return new AsyncM(p => this.run(p).then(x => f(x))); }
    // pure value as AsyncM
    static pure(x) { return new AsyncM(p => Promise.resolve(x)); }
    // this >>= f
    bind(f) { return new AsyncM(p => this.run(p).then(x => f(x).run(p))); }
    // flatten an AsyncM of AsyncM
    join() {
        return this.bind(m => ensureAsyncM(m));
    }
    // return type is not accurate to the implementation: error doesn't occur until it's run
    // this <*> mx
    app(mx) {
        return this.bind(f => {
            if (isFunction(f))
                return mx.bind(x => AsyncM.pure(f(x)));
            throw new TypeError();
        });
    }
    // return an AsyncM of AsyncM to wait for the result of 'this'
    //
    // AsyncM a -> AsyncM (AsyncM a)
    spawn() {
        return new SpawnM((p) => __awaiter(this, void 0, void 0, function* () {
            const e = new Emitter();
            this.run(p).then(x => e.emit(x));
            return e.wait();
        }));
    }
    // run 'this' without waiting for it to complete and return its progress for later cancellation
    fork() {
        return new AsyncM((p) => __awaiter(this, void 0, void 0, function* () {
            const p1 = p.cons();
            this.run(p1);
            return p1;
        }));
    }
    // run 'this' under a nested progress
    scope() { return new AsyncM(p => this.run(p.cons())); }
    // run 'this' under the parent progress
    unscope() {
        return new AsyncM((p) => {
            if (p instanceof ConsP)
                return this.run(p.tail == undefined ? p : p.tail);
            throw new Error();
        });
    }
    // lift AsyncM to a stream
    liftS() { return Stream.next(Maybe.nothing, this.bind(x => AsyncM.pure(Stream.pure(x)))); }
    // repeat 'AsyncM a' as 'Stream a'
    repeatS() { return Stream.next(Maybe.nothing, this.repeatA()); }
    // repeat 'AsyncM a' as 'AsyncM (Stream a)'
    repeatA() {
        return this.bind(a => AsyncM.ifAlive.bind(_ => AsyncM.pure(Stream.next(Maybe.just(a), this.repeatA()))));
    }
    // lift an IO to an AsyncM -- 'io' takes a continuation k and calls k with its result.
    //
    // liftIO :: ((a -> IO ()) -> IO ()) -> AsyncM a
    static liftIO(io) { return new AsyncM(p => new Promise(io)); }
    // lift a promise to an AsyncM
    //
    // liftIO :: Promise a -> AsyncM a
    static liftIO_(io) { return new AsyncM(p => io); }
    // completes after 'n' millisecond timeout
    static timeout(n) { return new AsyncM(_ => new Promise(k => setTimeout(k, n))); }
    /*
     * for testing purpose only
     */
    static interval(n, dt, f) {
        const h = (i) => AsyncM.ifAlive.bind(() => new AsyncM((p) => __awaiter(this, void 0, void 0, function* () {
            if (i <= n) {
                return AsyncM.timeout(dt)
                    .bind(_ => AsyncM.liftIO(k => k(f(i))).bind(_ => h(i + 1)))
                    .run(p);
            }
        })));
        return h(1);
    }
}
exports.AsyncM = AsyncM;
// an AsyncM that never completes -- no longer useful
AsyncM.never = new AsyncM(p => new Promise(_ => { }));
// cancel the current progress
AsyncM.cancel = new AsyncM(p => new Promise(k => { if (p.cancelP())
    k(); }));
// continues only if 'p' is still alive
//
// () => k() simulates the IO that k returns
AsyncM.ifAlive = new AsyncM(p => new Promise(k => { if (p.isAliveP())
    k(); }));
// if alive, then cancel
AsyncM.commit = AsyncM.ifAlive.bind(_ => AsyncM.cancel);
// run two AsyncM with a new progress
AsyncM.race = (m1) => (m2) => new AsyncM(p => new Promise(k => {
    m1.run(p).then(k);
    m2.run(p).then(k);
})).scope();
// race two AsyncM where the winner cancels the progress before returning its results
AsyncM.any = (m1) => (m2) => AsyncM.race(m1.bind(x1 => AsyncM.commit.bind(_ => AsyncM.pure(Either.left(x1)))))(m2.bind(x2 => AsyncM.commit.bind(_ => AsyncM.pure(Either.right(x2)))));
// run two AsyncM and wait for both of their results
AsyncM.all = (m1) => (m2) => new AsyncM(p => Promise.all([m1.run(p), m2.run(p)]));
/*
 * A hack to avoid making a chain of spawned AsyncMs (only a problem in 'combineLatest'),
 * which can leads to stack overflow for an event that rarely occurs.
 */
class SpawnM extends AsyncM {
    spawn() { return this; }
}
/*
 *  4. Emitter definition
 */
class Emitter {
    constructor() {
        this.now = undefined; // current event
        this.listeners = []; // blocked listeners
    }
    // emit an event to this emitter and wait up any pending listeners
    emit(x) {
        this.now = x;
        const l = this.listeners;
        this.listeners = [];
        const len = l.length;
        for (let i = 0; i < len; i++)
            l[i](x);
    }
    // listen for the next event as an AsyncM
    listen() { return new AsyncM(p => new Promise(k => { this.listeners.push(k); })); }
    // return the current event or wait for the future one
    wait() {
        return new AsyncM(p => new Promise(k => {
            if (this.now != undefined) {
                k(this.now);
            }
            else {
                // only keep one listeners
                this.listeners = [k];
            }
        }));
    }
    // listen to the future events as a stream
    receive() {
        const h = () => this.listen()
            .bind(a => AsyncM.ifAlive.bind(_ => AsyncM.pure(Stream.next(Maybe.just(a), h()))));
        return Stream.next(Maybe.nothing, h());
    }
}
/*
 *  5. Channel definition
 */
class Channel {
    constructor() {
        this.data = []; // data buffer
        this.listeners = []; // reader queue
    }
    // read :: (a -> IO()) -> IO()
    // read :: Promise a
    read() {
        return new Promise(k => {
            const d = this.data;
            if (d.length > 0) {
                k(d.shift()); // read one data
            }
            else {
                this.listeners.push(k); // add reader to the queue
            }
        });
    }
    // write :: a -> IO()
    write(x) {
        const l = this.listeners;
        if (l.length > 0) {
            const k = l.shift(); // wake up one reader in FIFO order
            k(x);
        }
        else {
            this.data.push(x); // buffer if no reader in the queue
        }
    }
}
/*
 *  6. Stream definition: use 'match' method to simulate pattern matching on End and Next cases
 */
class Stream {
    constructor(a) { this.maybe_a = a; }
    // run 's' by calling 'k' for each event of 'this' stream	
    run(k) {
        return AsyncM.ifAlive.bind(() => this.match(a => AsyncM.liftIO(k1 => k1(a.maybe(unit)(k))))((a, m) => AsyncM.liftIO(k1 => k1(a.maybe(unit)(k))).bind(_ => m.bind(s => s.run(k)))));
    }
    // f <$> this
    fmap(f) {
        return this.match(a => Stream.end(a.fmap(f)))((a, m) => Stream.next(a.fmap(f), m.fmap(s => s.fmap(f))));
    }
    // this <*> sx
    app(sx) {
        return this.bind(f => {
            if (isFunction(f))
                return sx.bind(x => Stream.pure(f(x)));
            throw new TypeError();
        });
    }
    // s >>= f
    bind(k) {
        return this.match(a => a.maybe(this)(k))(_ => this.fmap(k).join());
    }
    // flatten a stream of streams
    join() {
        let thism = this;
        let ret = thism.match(a => a.maybe(thism)(s => ensureStream(s)))((a, m) => a.maybe(Stream.next(Maybe.nothing, m.fmap(ss => ss.join())))(s => ensureStream(s).switchS(m)));
        return ret;
    }
    // switch 'this' stream on future stream of streams 'mss' -- usage: s.switchS(mss) 
    switchS(mss) {
        const h = (ms) => (mss) => AsyncM.any(mss)(ms.unscope()).fmap(r => r.either(ss => ss.join())(s => s.match(a => Stream.next(a, mss.fmap(ss => ss.join())))((a, m) => Stream.next(a, h(m)(mss)))));
        return this.match(a => Stream.next(a, mss.fmap(ss => ss.join())))((a, m) => Stream.next(a, mss.spawn().bind(mss1 => h(m)(mss1))));
    }
    // take a snapshot of the right stream 'sx' for each left stream event 'f' and return 'f x' as a stream
    leftApp(sx) {
        // run 's' until it emits the first 'Just' event 
        const h = (s) => s.match(_ => s)((a, m) => a.maybe(Stream.next(Maybe.nothing, m.fmap(h)))(x => Stream.end(Maybe.just(x))));
        return this.app(h(sx));
    }
    // broadcast the events of 'this' stream to an emitter 'e' 
    // and return [e, p], where 'p' is the progress for cancellation
    broadcast() {
        return AsyncM.liftIO(k => k(new Emitter()))
            .bind(e => this.run(x => e.emit(x))
            .fork()
            .bind(p => AsyncM.pure([e, p])));
    }
    // make a shareable stream and the associated progress
    multicast_() {
        return Stream.next(Maybe.nothing, this.broadcast()
            .bind(([e, p]) => AsyncM.pure(Stream.pure([e.receive(), p]))));
    }
    // only return the shareable stream
    multicast() { return this.multicast_().fmap(([s, _]) => s); }
    // zip 'this' with 'that' streams as a stream of pairs -- some events may be lost 
    zip(that) {
        return this.match(a1 => that.match(a2 => Stream.end(Maybe.pair(a1)(a2)))((a2, _) => Stream.end(Maybe.pair(a1)(a2))))((a1, m1) => that.match(a2 => Stream.end(Maybe.pair(a1)(a2)))((a2, m2) => Stream.next(Maybe.pair(a1)(a2), AsyncM.all(m1)(m2).bind(([s1, s2]) => AsyncM.ifAlive.bind(() => AsyncM.pure(s1.zip(s2)))))));
    }
    // zip a stream with indices starting from 'i'
    zipWithIndex(i) {
        return this.match(a => Stream.end(a.fmap((a) => [i, a])))((a, m) => Stream.next(a.fmap((a) => [i, a]), m.fmap(s => s.zipWithIndex(i + 1))));
    }
    // cancel the progress of a stream after reaching its end
    end() {
        const h = (s) => s.match(_ => AsyncM.cancel.bind(() => AsyncM.pure(s)))((a, m) => AsyncM.pure(Stream.next(a, m.bind(h))));
        return this.match(_ => this)((a, m) => Stream.next(a, m.bind(h).scope()));
    }
    // FIXME
    // take n events (Nothing does not count)
    take(n) {
        return (n <= 0)
            ? Stream.end(Maybe.nothing)
            : this.match(_ => this)((a, m) => (n <= 1 && a.isNothing())
                ? Stream.end(a)
                : Stream.next(a, this.next.fmap(s => s.take(a.maybe(n)(_ => n - 1)))));
    }
    // take n events and then cancel the progress
    take_(n) {
        return this.take(n).end();
    }
    // drop n events (Nothing does not count)
    drop(n) {
        const h = (n) => (s) => (n <= 0)
            ? s
            : s.match(() => Stream.end(Maybe.nothing))((a, m) => Stream.next(Maybe.nothing, m.fmap(s => h(a.maybe(n)(() => n - 1))(s))));
        return h(n)(this).just();
    }
    // omit the nothing events in a stream except the first one
    just() {
        const h = (s) => s.match(() => AsyncM.pure(s))((a, m) => a.maybe(m.bind(h))(x => AsyncM.pure(Stream.next(Maybe.just(x), m.bind(h)))));
        return this.match(() => this)((a, m) => Stream.next(a, m.bind(h)));
    }
    // wait 'dt' milliseconds before starting 'this' stream
    wait(dt) {
        return Stream.next(Maybe.nothing, AsyncM.timeout(dt).bind(_ => AsyncM.pure(this)));
    }
    // skipping events of 'this' stream for 'dt' milliseconds
    skip(dt) {
        return Stream.next(Maybe.nothing, AsyncM.timeout(dt).spawn().bind(mt => {
            const h = (s) => s.match(_ => AsyncM.pure(Stream.end(Maybe.nothing)))((_, m) => m.spawn().bind(ms => AsyncM.any(ms)(mt).bind(r => r.either(h)(_ => ms))));
            // match?
            return this.next.bind(h);
        }));
    }
    // delay each event in a stream by 'dt' milliseconds
    delay(dt) {
        const h = (s) => s.match(a => AsyncM.timeout(dt).fmap(_ => Stream.end(a)))((a, m) => AsyncM.timeout(dt).fmap(_ => Stream.next(a, m.bind(h))));
        return Stream.next(Maybe.nothing, h(this));
    }
    // stop after 'dt' millisecond
    stop(dt) {
        return this.match(() => this)(() => this.switchS(AsyncM.timeout(dt).fmap(_ => Stream.end(Maybe.nothing))));
    }
    //FIXME
    // fold the functions in 'this' stream with an initial value 'a0' 
    // and output the result of each fold as a stream
    accumulate(a0) {
        let thism = this;
        return thism.match(a => Stream.end(Maybe.just(a.maybe(a0)(f => f(a0)))))((a, m) => {
            const a1 = a.maybe(a0)(f => f(a0));
            return Stream.next(Maybe.just(a1), m.fmap(s => s.accumulate(a1)));
        });
    }
    // return the last event of 'this' stream before 'm' emits
    last(m) {
        return m.spawn().bind((m1) => {
            const h = (s) => s.match(a => AsyncM.pure(a))((a, m) => AsyncM.any(m)(m1).bind(r => r.either(h)(_ => AsyncM.pure(a))));
            return h(this);
        });
    }
    //FIXME
    // fold the functions of 'this' stream for 'n' milliseconds and return the final result
    fold(n) {
        return c => this.accumulate(c).last(AsyncM.timeout(n)).fmap(r => r.fromJust());
    }
    // count the number of events in 'this' stream within 'n' milliseconds
    count(n) {
        return this.fmap(_ => (c) => c + 1).fold(n)(0);
    }
    // run 'this' stream until the future stream 'ms' emits its stream
    until(ms) {
        return Stream.next(Maybe.just(this), ms.fmap(s => Stream.pure(s))).join();
    }
    static fetch(s) {
        const m = AsyncM.liftIO(k => k(new Channel())).bind(c => {
            const w = s.bind(m => m.spawn().liftS()).run(m1 => c.write(m1)).fork();
            // We don't use the progress 'p' here but do we need to cancel it later?
            return w.bind(p => AsyncM.liftIO(k => k(c.read())).join().repeatA());
        });
        return Stream.next(Maybe.nothing, m);
    }
    //FIXME
    // convert a stream of requests to a stream of responses
    //
    // fetch :: Stream (AsyncM a) -> Stream a
    fetch() {
        let thism = this;
        return Stream.fetch(thism);
    }
    // return 'sum (dt) / n' after 'n' milliseconds, where 'this' is a stream of (dt, a) pairs 
    //
    // speed :: Stream (Time, a) -> Time -> AsyncM Float
    speed(n) {
        let thism = this;
        return thism.fmap(([dt, _]) => (t) => t + dt).fold(n)(0).fmap((t) => t / n);
    }
    // test whether the speed should be adjusted after a 'duration' using the indicator function 'f'
    //
    // speedControl :: Stream (Time, a) -> Time -> (Double -> Int) -> AsyncM Bool
    // f(x) ==  0 means no change (right speed)
    // f(x) ==  1 means True (too fast)
    // f(x) == -1 means False (too slow)
    speedControl(duration) {
        return (f) => {
            const ms = AsyncM.timeout(duration).bind(_ => this.speed(duration).bind(x => {
                // console.log(x); 
                const d = f(x);
                return (d == 0) ? ms : AsyncM.pure(d == 1);
            }));
            return ms;
        };
    }
    // convert 'this' stream to a pull signal
    push2pull() {
        return AsyncM.liftIO(k => k(new Channel())).bind(c => this.run(x => c.write(x)).fork().bind(p => AsyncM.pure(new Signal(() => c.read()))));
    }
    // convert a stream of requests to a signal
    //
    // fetchG :: Stream (AsyncM a) -> AsyncM (Signal a)
    fetchG() {
        let thism = this;
        return thism.fetch().push2pull();
    }
}
exports.Stream = Stream;
Stream.next = (a, m) => new Next(a, m);
Stream.end = (a) => new End(a);
Stream.pure = (x) => Stream.end(Maybe.just(x));
// emits a number from 1 to n every 'dt' milliseconds 
Stream.interval = (dt, n) => {
    const h = (x) => (x >= n)
        ? AsyncM.pure(Stream.end(Maybe.just(x)))
        : AsyncM.ifAlive.bind(_ => AsyncM.pure(Stream.next(Maybe.just(x), AsyncM.timeout(dt).bind(_ => h(x + 1)))));
    return Stream.next(Maybe.nothing, AsyncM.timeout(0).bind(_ => h(1)));
};
// an indirect way to make an interval
Stream.interval_ = (dt, n) => Stream.forever(dt).zipWithIndex(0).fmap(([i, _]) => i).take(n);
// emit unit every 'dt' millisecond forever.
Stream.forever = (dt) => AsyncM.timeout(dt).repeatS();
// return a finite stream with elements in 'lst' 
Stream.fromList = (lst) => {
    if (lst.length == 0) {
        return Stream.end(Maybe.nothing);
    }
    else {
        let [a, ...b] = lst;
        return Stream.next(Maybe.just(a), AsyncM.pure(Stream.fromList(b)));
    }
};
// converts a stream of requests (of the sampling period 'dt' and latency 'delay') to a stream of (dt, a) pairs
//
// request :: (Time -> AsyncM a) -> Time -> Time -> Stream (Time, a)
Stream.request = (async_fun) => (dt) => (delay) => Stream.forever(delay).fmap(_ => async_fun(dt)).fetch().fmap(x => [dt, x]);
// control the speed of a stream of requests by adjusting the sampling rate 'dt' using the 'adjust' function
//
// control :: (t -> Stream (AsyncM a)) -> Int -> t -> (Bool -> t -> t) -> Stream (t, a) 
Stream.control = (req_fun) => (duration) => (dt) => (adjust) => {
    const h = (dt) => req_fun(dt).multicast_().bind(([request, p1]) => request.fetch().multicast_().bind(([response, p2]) => {
        const mss = AsyncM.timeout(duration).bind(_ => AsyncM.all(response.count(duration))(request.count(duration))
            .bind(([x, y]) => {
            console.log(x, y);
            if (x == y) {
                return mss;
            }
            else {
                p1.cancelP();
                p2.cancelP();
                return AsyncM.pure(h(adjust(x < y)(dt)));
            }
        }));
        return Stream.next(Maybe.just(response.fmap((x) => [dt, x])), mss);
    }));
    return h(dt).join();
};
// converts a  stream of requests (of the sampling period 'dt') to an Event Siganl
//
// fetchE  :: (Time -> Stream (AsyncM a)) -> Time -> AsyncM (Event a)
Stream.fetchE = (req_fun) => (dt) => req_fun(dt).fetch().fmap(x => [dt, x]).push2pull();
// apply each event in 'this' to each event in 'sx'
function combineLatest(sf, sx) {
    const _appF = (sf) => (sx) => sf.match(f => _appX(f)(sx))((f, mf) => _appFX(f, mf)(sx));
    const _appX = (f) => (sx) => sx.match(x => Stream.end(f.app(x)))((x, mx) => Stream.next(f.app(x), mx.fmap(sx => _appX(f)(sx))));
    const _appFX = (f, mf) => (sx) => sx.match(x => Stream.next(f.app(x), mf.fmap(sf => _appF(sf)(sx))))((x, mx) => Stream.next(f.app(x), mf.spawn().bind(mf1 => mx.spawn().bind(mx1 => AsyncM.any(mf1)(mx1).bind(r => AsyncM.pure(r.either(sf => _appF(sf)(Stream.next(x, mx1)))(sx => _appFX(f, mf1)(sx))))))));
    return _appF(sf)(sx);
}
exports.combineLatest = combineLatest;
class End extends Stream {
    constructor(a) { super(a); }
    // pattern match 'End' case
    match(f_end) { return () => f_end(this.maybe_a); }
}
class Next extends Stream {
    constructor(a, m) {
        super(a);
        this.next = m;
    }
    // pattern match 'Next' case
    match() { return (f_next) => f_next(this.maybe_a, this.next); }
}
/*
 *  6. Signal definition: Signal (Event Signal) and Behavior
 */
/*
 * The Signal class -- imperative implementation to reduce overhead
 *
 * The run function only passes the data 'a', not a pair (a, Signal a), to its callback parameter,
 *
 * A signal object should be reused to generate the next value.
 */
class Signal {
    // run :: (a -> IO ()) -> IO ()
    // run :: _ -> Promise a
    constructor(run) {
        this.run = run;
    }
    // f <$> this
    fmap(f) { return new Signal(() => this.run().then(f)); }
    // this <*> gx
    app(gx) {
        let thism = this.fmap(ensureFunction);
        return new Signal(() => Promise.all([thism.run(), gx.run()]).then(([f, x]) => f(x)));
    }
    // run a signal as a stream with added 'delay' between events
    reactimate(delay) {
        const h = AsyncM.timeout(delay).bind(_ => AsyncM.ifAlive.bind(_ => AsyncM.liftIO_(this.run()).bind(a => AsyncM.pure(Stream.next(Maybe.just(a), h)))));
        return Stream.next(Maybe.nothing, h);
    }
}
exports.Signal = Signal;
Signal.pure = (a) => new Signal(() => Promise.resolve(a));
// The following two methods only make sense for 'Signal (Time, a)' (i.e. 'Event a')
// convert an Event Signal to a Behavior using a summary function 
//
// stepper :: Signal (Time, a) -> ([(Time, a)] -> a) -> Behavior a	
function stepper(s, summary) {
    let leftover = null;
    const f = (lst) => (lst.length == 1) ? lst[0][1] : summary(lst);
    const h = (dt) => __awaiter(this, void 0, void 0, function* () {
        let lst = [];
        if (leftover == null) {
            leftover = yield s.run();
        }
        let [dt1, a] = leftover;
        while (dt > dt1) {
            lst.push([dt1, a]);
            dt = dt - dt1;
            [dt1, a] = yield s.run();
        }
        leftover = (dt == dt1) ? null : [dt1 - dt, a];
        lst.push([dt, a]);
        return f(lst);
    });
    return new Behavior(h);
}
exports.stepper = stepper;
// convert an Event Signal of batches to an Event Signal of samples
//
// unbatch :: Signal (Time, [a]) -> Signal (Time, a)
function unbatch(s) {
    let leftover = null;
    let h = () => __awaiter(this, void 0, void 0, function* () {
        if (leftover == null) {
            leftover = yield s.run();
        }
        let [dt, lst] = leftover;
        const a = lst.shift();
        if (lst.length == 0) {
            leftover = null;
        }
        return [dt, a];
    });
    return new Signal(h);
}
exports.unbatch = unbatch;
/*
 * The behavior class -- also imperative like the Signal class
 *
 * The run function only passes the data 'a', not a pair (a, Behavior a), to its callback parameter,
 *
 * A behavior object should be reused to generate the next value.
 */
class Behavior {
    // run :: Time -> (a -> IO()) -> IO()
    // run :: Time -> Promise a
    constructor(run) {
        this.run = run;
    }
    // f <$> this
    fmap(f) { return new Behavior(dt => this.run(dt).then(x => f(x))); }
    // this <*> bx
    app(bx) {
        let thism = this.fmap(ensureFunction);
        return new Behavior(dt => Promise.all([thism.run(dt), bx.run(dt)]).then(([f, x]) => f(x)));
    }
    // run 'this' behavior as a stream with added 'delay' between events and sampling period 'dt' 
    reactimate(delay) {
        return dt => {
            const h = AsyncM.timeout(delay).bind(_ => AsyncM.ifAlive.bind(_ => AsyncM.liftIO_(this.run(dt)).bind(a => AsyncM.pure(Stream.next(Maybe.just([dt, a]), h)))));
            return Stream.next(Maybe.nothing, h);
        };
    }
    // convert a behavior to an Event Signal of batches with 'size' number of samples and 'dt' sampling period 
    //
    // batch :: Behavior a -> Time -> Int -> Signal (Time, [a])
    batch(dt) {
        return (size) => new Signal(() => __awaiter(this, void 0, void 0, function* () {
            let batch = [];
            for (let i = 0; i < size; i++) {
                const x = yield this.run(dt);
                batch[i] = x;
            }
            return [dt, batch];
        }));
    }
    // upsample :: Behavior a -> Int -> Behavior [a]
    upsample(factor) {
        return new Behavior(dt => this.run(dt * factor).then(a => Array(factor).fill(a)));
    }
    // downsample  :: Behavior a -> Int -> ([(Int, a)] -> a) -> Behavior a 
    downsample(factor) {
        return summary => new Behavior((dt) => __awaiter(this, void 0, void 0, function* () {
            const dt1 = dt / factor;
            let lst = [];
            for (let i = 0; i < factor; i++) {
                let x = yield this.run(dt1);
                lst[i] = [dt1, x];
            }
            return summary(lst);
        }));
    }
    // convert a Behavior to an Event Signal of batches with sampling period 'dt', 
    // where each batch is a sliding window created with specified 'size' and 'stride'
    //
    // windowing :: Behavior a -> Int -> Int -> Time -> Event [a]
    windowing(size) {
        return stride => dt => {
            const _lst = []; // Hack: stores the temporary window in shared variable '_lst' 
            return new Signal(() => __awaiter(this, void 0, void 0, function* () {
                if (_lst.length == 0) {
                    // make a full window first
                    for (let i = 0; i < size; i++) {
                        let a = yield this.run(dt);
                        _lst.push(a);
                    }
                }
                else {
                    // make a new window for each stride
                    for (let i = 0; i < stride; i++) {
                        let a = yield this.run(dt);
                        _lst.push(a); // push new data at the end
                        _lst.shift(); // pop old data in the front 
                    }
                }
                return [dt * stride, _lst];
            }));
        };
    }
}
exports.Behavior = Behavior;
Behavior.pure = (a) => new Behavior(() => Promise.resolve(a));
