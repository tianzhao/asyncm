export { AsyncM, Stream, Progress, Behavior, Signal, Duration, stepper, unbatch, combineLatest };

/*
 *  1. utility definitions: unit, Maybe, and Either
 */

type Unit = void;
const unit: Unit = undefined;

type Func<A,B> = (a: A) => B;
type Time = number;
type Duration = number;

type MaybeAppResult<T, A> = T extends Func<A, infer B> ? Maybe<B> : never;

type AsyncMAppResult<T, A> = T extends Func<A, infer B> ? AsyncM<B> : never;
type AsyncMJoinResult<T> = T extends AsyncM<infer R> ? AsyncM<R> : never;

type StreamAppResult<T, A> = T extends Func<A, infer B> ? Stream<B> : never;
type StreamJoinResult<T> = T extends Stream<infer R> ? Stream<R> : never;

type SignalAppResult<T, A> = T extends Func<A, infer B> ? Signal<B> : never;
type BehaviorAppResult<T, A> = T extends Func<A, infer B> ? Behavior<B> : never;

type IfUnknown<T, AS, ELSE> = unknown extends T ? AS : ELSE;
type Ease<T> = IfUnknown<T, any, T>;

type EnsureTuple<T> = T extends [infer A, infer B] ? [Ease<A>, Ease<B>] : never;
type EnsureFunc<T> = T extends Func<infer A, infer B> ? Func<Ease<A>,Ease<B>> : never;
type EnsureAsyncM<T> = T extends AsyncM<infer A> ? AsyncM<A> : never;
type EnsureStream<T> = T extends Stream<infer A> ? Stream<A> : never;

function isFunction<A,B>(f: any): f is Func<A,B> {
	return typeof f === "function";
}
function ensureTuple<T>(t: T): IfUnknown<T, [any, any], EnsureTuple<T>> {
	if (t instanceof Array) return t as any;
	throw new TypeError();
}

function ensureFunction<T>(f: T): IfUnknown<T, Func<any, any>, EnsureFunc<T>> {
	if (f instanceof Function) return f as any;
	throw new TypeError();
}

function ensureAsyncM<T>(m: T): IfUnknown<T, AsyncM<any>, EnsureAsyncM<T>> {
	if (m instanceof AsyncM) return m as any;
	throw new TypeError();
}

function ensureStream<T>(m: T): IfUnknown<T, Stream<any>, EnsureStream<T>> {
	if (m instanceof Stream) return m as any;
	throw new TypeError();
}

/*
 * Maybe type
 */

abstract class Maybe<T> {
	abstract maybe<B>(def: B): (f: (a: T) => B) => B;
	abstract fromJust(): T;
	abstract isNothing(): boolean;

	abstract fmap<B>(f: (a: T) => B): Maybe<B>;
	abstract app<A>(mx: Maybe<A>): MaybeAppResult<T,A>;

	static nothing: Nothing<any>;
	static just<T>(val: T) { return new Just<T>(val); }
	static pair = <T1>(a: Maybe<T1>) => <T2>(b: Maybe<T2>): Maybe<[T1,T2]> => a.fmap(x => (y: T2): [T1,T2] => [x, y]).app(b);
}

class Nothing<T> extends Maybe<T> {
	maybe<B>(def: B) { return () => def; }
	fromJust(): never { throw new TypeError(); }
	isNothing(): boolean { return true; }

	fmap<B>(f: (a: T) => B): Nothing<B> { return this as any; }
	app<A>(_: Maybe<A>): MaybeAppResult<T,A> { return this as any; }
}

Maybe.nothing = new Nothing<any>();


class Just<T> extends Maybe<T> {
	value: T;

	constructor(value: T) {
		super();
		this.value = value;
	}

	maybe<B>(_: B) {
		return (f: (a: T) => B) => f(this.value);
	}

	fromJust(): T { return this.value; }
	isNothing(): boolean { return false; }

	fmap<B>(f: (a: T) => B): Just<B> { return new Just(f(this.value)); }

	app<A,B>(maybeX: Maybe<A>): MaybeAppResult<T,A> {
		if (!isFunction<A,B>(this.value))
			throw new TypeError();
		return maybeX.fmap<B>(this.value) as any;
	}
}


/*
 * Either type
 */

abstract class Either<A, B> {
	abstract either<C>(l: (a: A) => C): (r: (b: B) => C) => C;
	static left<A,B>(x: A): Either<A,B> { return new Left(x); }
	static right<A,B>(x: B): Either<A,B> { return new Right(x); }
};

class Left<A, B> extends Either<A, B> {
	value: A;

	constructor(value: A) {
		super();
		this.value = value;
	}

	either<C>(l: (a: A) => C) {
		return (_: (b: B) => C) => l(this.value);
	}
}

class Right<A, B> extends Either<A, B> {
	value: B;

	constructor(value: B) {
		super();
		this.value = value;
	}

	either<C>(l: Func<A,C>): (r: Func<B,C>) => C { return r => r(this.value); }
}


/*
 *  2. Progress definitions: Progress, ConsP, and NilP
 */

abstract class Progress {
	head: boolean;

	constructor() {
		this.head = false;
	}
	static nil() { return new NilP(); }

	cons() { return new ConsP(this); }

	cancelP() {
		if (!this.head) {
			this.head = true;
			return true;
		} else {
			return false;
		}
	}

	abstract isAliveP(): boolean;
}

class ConsP extends Progress {
	tail: Progress;

	constructor(tail: Progress) {
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


class AsyncM<T> {
	_run: (p: Progress) => Promise<T>;

	run(p?: Progress): Promise<T> {
		if (p === undefined) p = Progress.nil();
		return this._run(p);
	}

	// run :: Progress -> (a -> IO ()) -> IO ()
	// run :: Progress -> Promise a 
	constructor(run: (p: Progress) => Promise<T>) {
		this._run = run;
	}

	// f <$> this
	fmap<R>(f: (a: T) => R): AsyncM<R> { return new AsyncM<R>(p => this.run(p).then(x => f(x))); }

	// pure value as AsyncM
	static pure<R>(x: R): AsyncM<R> { return new AsyncM<R>(p => Promise.resolve(x)); }

	// this >>= f
	bind<R>(f: (a: T) => AsyncM<R>): AsyncM<R> { return new AsyncM(p => this.run(p).then(x => f(x).run(p))); }

	// flatten an AsyncM of AsyncM
	join(): AsyncMJoinResult<T> {
		return this.bind(m => ensureAsyncM(m)) as any;
	}

	// return type is not accurate to the implementation: error doesn't occur until it's run
	// this <*> mx
	app<A>(mx: AsyncM<A>): AsyncMAppResult<T, A> {
		return this.bind(f => {
			if (isFunction(f))
				return mx.bind(x => AsyncM.pure(f(x)));
			throw new TypeError();
		}) as any;
	}

	// return an AsyncM of AsyncM to wait for the result of 'this'
	//
	// AsyncM a -> AsyncM (AsyncM a)
	spawn(): SpawnM<AsyncM<T>> {
		return new SpawnM(async p => {
			const e = new Emitter<T>();
			this.run(p).then(x => e.emit(x));
			return e.wait();
		});
	}

	// run 'this' without waiting for it to complete and return its progress for later cancellation
	fork(): AsyncM<Progress> {
		return new AsyncM(async p => {
			const p1 = p.cons();
			this.run(p1);
			return p1;
		});
	}

	// run 'this' under a nested progress
	scope(): AsyncM<T> { return new AsyncM(p => this.run(p.cons())); }

	// run 'this' under the parent progress
	unscope(): AsyncM<T> {
		return new AsyncM((p: Progress) => {
			if (p instanceof ConsP)
				return this.run(p.tail == undefined ? p : p.tail);
			throw new Error();
		});
	}

	// lift AsyncM to a stream
	liftS(): Stream<T> { return Stream.next(Maybe.nothing, this.bind(x => AsyncM.pure(Stream.pure(x)))); }

	// repeat 'AsyncM a' as 'Stream a'
	repeatS(): Stream<T> { return Stream.next(Maybe.nothing, this.repeatA()); }

	// repeat 'AsyncM a' as 'AsyncM (Stream a)'
	repeatA(): AsyncM<Stream<T>> {
		return this.bind(a =>
			AsyncM.ifAlive.bind(_ =>
				AsyncM.pure(Stream.next(Maybe.just(a), this.repeatA()))));
	}

	// lift an IO to an AsyncM -- 'io' takes a continuation k and calls k with its result.
	//
	// liftIO :: ((a -> IO ()) -> IO ()) -> AsyncM a
	static liftIO<R>(io: (k: (a: R | PromiseLike<R>) => void) => void): AsyncM<R> { return new AsyncM<R>(p => new Promise(io)); }

	// lift a promise to an AsyncM
	//
	// liftIO :: Promise a -> AsyncM a
	static liftIO_<R>(io: Promise<R>): AsyncM<R> { return new AsyncM<R>(p => io); }

	// an AsyncM that never completes -- no longer useful
	static never: AsyncM<never> = new AsyncM(p => new Promise(_ => { }));

	// completes after 'n' millisecond timeout
	static timeout(n: Duration): AsyncM<void> { return new AsyncM(_ => new Promise(k => setTimeout(k, n))); }

	// cancel the current progress
	static cancel: AsyncM<Unit> = new AsyncM(p => new Promise<void>(k => { if (p.cancelP()) k(); }));

	// continues only if 'p' is still alive
	//
	// () => k() simulates the IO that k returns
	static ifAlive: AsyncM<Unit> = new AsyncM(p => new Promise<void>(k => { if (p.isAliveP()) k(); }));

	// if alive, then cancel
	static commit: AsyncM<Unit> = AsyncM.ifAlive.bind(_ => AsyncM.cancel);

	// run two AsyncM with a new progress
	static race = <A>(m1: AsyncM<A>) => (m2: AsyncM<A>): AsyncM<A> =>
		new AsyncM<A>(p => new Promise(k => {
			m1.run(p).then(k);
			m2.run(p).then(k);
		})).scope();

	// race two AsyncM where the winner cancels the progress before returning its results
	static any = <A>(m1: AsyncM<A>) => <B>(m2: AsyncM<B>): AsyncM<Either<A, B>> =>
		AsyncM.race
			(m1.bind(x1 => AsyncM.commit.bind(_ => AsyncM.pure(Either.left<A,B>(x1)))))
			(m2.bind(x2 => AsyncM.commit.bind(_ => AsyncM.pure(Either.right<A,B>(x2)))))

	// run two AsyncM and wait for both of their results
	static all = <A>(m1: AsyncM<A>) => <B>(m2: AsyncM<B>): AsyncM<[A, B]> =>
		new AsyncM(p => Promise.all([m1.run(p), m2.run(p)]));

	/*
	 * for testing purpose only 
	 */
	static interval<A>(n: number, dt: number, f: (a: number) => A): AsyncM<A | void> {
		const h = (i: number): AsyncM<A | void> =>
			AsyncM.ifAlive.bind(() =>
				new AsyncM(async p => {
					if (i <= n) {
						return AsyncM.timeout(dt)
							.bind(_ => AsyncM.liftIO(k => k(f(i))).bind(_ => h(i + 1)))
							.run(p);
					}
				}));
		return h(1);
	}
}

/*
 * A hack to avoid making a chain of spawned AsyncMs (only a problem in 'combineLatest'), 
 * which can leads to stack overflow for an event that rarely occurs.
 */
class SpawnM<A> extends AsyncM<A> { spawn(): SpawnM<AsyncM<A>> { return this as any; } }


/*
 *  4. Emitter definition
 */
class Emitter<T> {
	now: T | undefined;
	listeners: Array<(a: T) => void>;

	constructor() {
		this.now = undefined;  // current event
		this.listeners = [];   // blocked listeners
	}

	// emit an event to this emitter and wait up any pending listeners
	emit(x: T): void {
		this.now = x;
		const l = this.listeners;
		this.listeners = [];
		const len = l.length;

		for (let i = 0; i < len; i++)
			l[i](x);
	}

	// listen for the next event as an AsyncM
	listen(): AsyncM<T> { return new AsyncM(p => new Promise(k => { this.listeners.push(k); })); }

	// return the current event or wait for the future one
	wait(): AsyncM<T> {
		return new AsyncM(p => new Promise(k => {
			if (this.now != undefined) { k(this.now); }
			else {
				// only keep one listeners
				this.listeners = [k];
			}
		}));
	}

	// listen to the future events as a stream
	receive(): Stream<T> {
		const h = (): AsyncM<Stream<T>> => this.listen()
			.bind(a => AsyncM.ifAlive.bind(_ =>
				AsyncM.pure(Stream.next(Maybe.just(a), h()))
			));
		return Stream.next(Maybe.nothing, h());
	}
}


/*
 *  5. Channel definition
 */

class Channel<T> {
	data: Array<T>;
	listeners: Array<(a: T) => void>;

	constructor() {
		this.data = [];			// data buffer
		this.listeners = [];		// reader queue
	}

	// read :: (a -> IO()) -> IO()
	// read :: Promise a
	read(): Promise<T> {
		return new Promise(k => {
			const d = this.data;
			if (d.length > 0) {
				k(d.shift()!); 		// read one data
			} else {
				this.listeners.push(k); // add reader to the queue
			}
		});
	}

	// write :: a -> IO()
	write(x: T): void {
		const l = this.listeners;
		if (l.length > 0) {
			const k = l.shift()!; 	// wake up one reader in FIFO order
			k(x);
		}
		else {
			this.data.push(x); 	// buffer if no reader in the queue
		}
	}
}


/*
 *  6. Stream definition: use 'match' method to simulate pattern matching on End and Next cases
 */

abstract class Stream<T> {
	maybe_a: Maybe<T>

	constructor(a: Maybe<T>) { this.maybe_a = a; }

	abstract match<R>(fEnd: (a: Maybe<T>) => R): (fNext: (a: Maybe<T>, b: AsyncM<Stream<T>>) => R) => R;

	// run 's' by calling 'k' for each event of 'this' stream	
	run(k: (a: T) => void): AsyncM<void> {
		return AsyncM.ifAlive.bind(() =>
			this.match
				(a => AsyncM.liftIO<void>(k1 => k1(a.maybe(unit)(k))))
				((a, m) => AsyncM.liftIO<void>(k1 => k1(a.maybe(unit)(k))).bind(_ => m.bind(s => s.run(k))))
		);
	}

	// f <$> this
	fmap<R>(f: (a: T) => R): Stream<R> {
		return this.match
			(a => Stream.end(a.fmap(f)))
			((a, m) => Stream.next(a.fmap(f), m.fmap(s => s.fmap(f))));
	}

	// this <*> sx
	app<A>(sx: Stream<A>): StreamAppResult<T,A> {
		return this.bind(f => {
			if (isFunction(f))
				return sx.bind(x => Stream.pure(f(x)));
			throw new TypeError();
		}) as any;
	}

	// s >>= f
	bind<R>(k: (a: T) => Stream<R>): Stream<R> {
		return this.match
			(a => a.maybe(this as any)(k))
			(_ => this.fmap(k).join());
	}

	// flatten a stream of streams
	join(): StreamJoinResult<T> {
		let thism = this as any as Stream<Stream<T>>;
		let ret: Stream<unknown> = thism.match
			(a => a.maybe(thism as any)(s => ensureStream(s)))
			((a, m) => a.maybe(Stream.next(Maybe.nothing, m.fmap(ss => ss.join())))(s => ensureStream(s).switchS(m)))
		return ret as any;
	}

	// switch 'this' stream on future stream of streams 'mss' -- usage: s.switchS(mss) 
	switchS(mss: AsyncM<Stream<Stream<T>>>): Stream<T> {
		const h = (ms: AsyncM<Stream<T>>) => (mss: AsyncM<Stream<Stream<T>>>): AsyncM<Stream<T>> =>
			AsyncM.any(mss)(ms.unscope()).fmap(r =>
				r.either
					(ss => ss.join())
					(s => s.match(a => Stream.next(a, mss.fmap(ss => ss.join())))
						((a, m) => Stream.next(a, h(m)(mss))))
			);

		return this.match
			(a => Stream.next(a, mss.fmap(ss => ss.join())))
			((a, m) => Stream.next(a, mss.spawn().bind(mss1 => h(m)(mss1))))
	}

	// take a snapshot of the right stream 'sx' for each left stream event 'f' and return 'f x' as a stream
	leftApp<A>(sx: Stream<A>): StreamAppResult<T,A> {
		// run 's' until it emits the first 'Just' event 
		const h = (s: Stream<A>): Stream<A> => s.match
			(_ => s)
			((a, m) => a.maybe(Stream.next(Maybe.nothing, m.fmap(h)))(x => Stream.end(Maybe.just(x))));

		return this.app(h(sx));
	}

	// broadcast the events of 'this' stream to an emitter 'e' 
	// and return [e, p], where 'p' is the progress for cancellation
	broadcast(): AsyncM<[Emitter<T>, Progress]> {
		return AsyncM.liftIO<Emitter<T>>(k => k(new Emitter<T>()))
			.bind(e => this.run(x => e.emit(x))
				.fork()
				.bind(p => AsyncM.pure([e, p])));
	}

	// make a shareable stream and the associated progress
	multicast_(): Stream<[Stream<T>, Progress]> {
		return Stream.next(Maybe.nothing,
			this.broadcast()
				.bind(([e, p]) => AsyncM.pure(Stream.pure([e.receive(), p]))));
	}

	// only return the shareable stream
	multicast() { return this.multicast_().fmap(([s, _]) => s); }

	// zip 'this' with 'that' streams as a stream of pairs -- some events may be lost 
	zip<R>(that: Stream<R>): Stream<[T,R]> {
		return this.match
			(a1 => that.match
				(a2 => Stream.end(Maybe.pair(a1)(a2)))
				((a2, _) => Stream.end(Maybe.pair(a1)(a2))))
			((a1, m1) => that.match
				(a2 => Stream.end(Maybe.pair(a1)(a2)))
				((a2, m2) => Stream.next(Maybe.pair(a1)(a2),
					AsyncM.all(m1)(m2).bind(([s1, s2]: [Stream<T>, Stream<R>]): AsyncM<Stream<[T,R]>> =>
						AsyncM.ifAlive.bind(() =>
							AsyncM.pure(s1.zip(s2)))))));
	}

	// zip a stream with indices starting from 'i'
	zipWithIndex(i: number): Stream<[number, T]> {
		return this.match
			(a => Stream.end(a.fmap((a: T): [number, T] => [i, a])))
			((a, m) => Stream.next(a.fmap((a: T): [number, T] => [i, a]), m.fmap(s => s.zipWithIndex(i + 1))));
	}

	// cancel the progress of a stream after reaching its end
	end(): Stream<T> {
		const h = (s: Stream<T>): AsyncM<Stream<T>> => s.match
			(_ => AsyncM.cancel.bind(() => AsyncM.pure(s)))
			((a, m) => AsyncM.pure(Stream.next(a, m.bind(h))))

		return this.match
			(_ => this as Stream<T>)
			((a, m) => Stream.next(a, m.bind(h).scope()));
	}

	// FIXME
	// take n events (Nothing does not count)
	take(n: number): Stream<T> {
		return (n <= 0)
			? Stream.end(Maybe.nothing)
			: this.match
				(_ => this as Stream<T>)
				((a, m) => (n <= 1 && a.isNothing())
					? Stream.end(a)
					: Stream.next(a, (this as unknown as Next<T>).next.fmap(s => s.take(a.maybe(n)(_ => n - 1)))))
	}

	// take n events and then cancel the progress
	take_(n: number): Stream<T> {
		return this.take(n).end();
	}

	// drop n events (Nothing does not count)
	drop(n: number): Stream<T> {
		const h = (n: number) => (s: Stream<T>): Stream<T> => (n <= 0)
			? s
			: s.match
				(() => Stream.end(Maybe.nothing))
				((a, m) => Stream.next(Maybe.nothing, m.fmap(s => h(a.maybe(n)(() => n - 1))(s))))

		return h(n)(this).just();
	}

	// omit the nothing events in a stream except the first one
	just(): Stream<T> {
		const h = (s: Stream<T>): AsyncM<Stream<T>> => s.match
			(() => AsyncM.pure(s))
			((a, m) => a.maybe(m.bind(h))(x => AsyncM.pure(Stream.next(Maybe.just(x), m.bind(h)))));

		return this.match
			(() => this as Stream<T>)
			((a, m) => Stream.next(a, m.bind(h)));
	}

	// wait 'dt' milliseconds before starting 'this' stream
	wait(dt: number): Stream<T> {
		return Stream.next(Maybe.nothing, AsyncM.timeout(dt).bind(_ => AsyncM.pure(this)));
	}

	// skipping events of 'this' stream for 'dt' milliseconds
	skip(dt: number): Stream<T> {
		return Stream.next(Maybe.nothing, AsyncM.timeout(dt).spawn().bind(mt => {
			const h = (s: Stream<T>): AsyncM<Stream<T>> => s.match
				(_ => AsyncM.pure(Stream.end(Maybe.nothing)))
				((_, m) => m.spawn().bind(ms => AsyncM.any(ms)(mt).bind(r => r.either(h)(_ => ms))))

			// match?
			return (this as unknown as Next<T>).next.bind(h);
		}));
	}

	// delay each event in a stream by 'dt' milliseconds
	delay(dt: number): Stream<T> {
		const h = (s: Stream<T>): AsyncM<Stream<T>> => s.match
			(a => AsyncM.timeout(dt).fmap(_ => Stream.end(a)))
			((a, m) => AsyncM.timeout(dt).fmap(_ => Stream.next(a, m.bind(h))));

		return Stream.next(Maybe.nothing, h(this));
	}

	// stop after 'dt' millisecond
	stop(dt: number): Stream<T> {
		return this.match
			(() => this as Stream<T>)
			(() => this.switchS(AsyncM.timeout(dt).fmap(_ => Stream.end(Maybe.nothing))));
	}

	//FIXME
	// fold the functions in 'this' stream with an initial value 'a0' 
	// and output the result of each fold as a stream
	accumulate<A>(a0: A): Stream<A> {
		let thism = this as unknown as Stream<(a: A) => A>;
		return thism.match
			(a => Stream.end(Maybe.just(a.maybe(a0)(f => f(a0)))))
			((a, m) => {
				const a1 = a.maybe(a0)(f => f(a0));
				return Stream.next(Maybe.just(a1), m.fmap(s => s.accumulate(a1)));
			});
	}

	// return the last event of 'this' stream before 'm' emits
	last(m: AsyncM<any>): AsyncM<Maybe<T>> {
		return m.spawn().bind((m1: AsyncM<any>) => {
			const h = (s: Stream<T>): AsyncM<Maybe<T>> => s.match
				(a => AsyncM.pure(a))
				((a, m) => AsyncM.any(m)(m1).bind(r => r.either(h)(_ => AsyncM.pure(a))))
			return h(this)
		});
	}

	//FIXME
	// fold the functions of 'this' stream for 'n' milliseconds and return the final result
	fold(n: number): <A>(c: A) => AsyncM<A> {
		return c => this.accumulate(c).last(AsyncM.timeout(n)).fmap(r => r.fromJust());
	}

	// count the number of events in 'this' stream within 'n' milliseconds
	count(n: number): AsyncM<number> {
		return this.fmap(_ => (c: number) => c + 1).fold(n)(0);
	}

	// run 'this' stream until the future stream 'ms' emits its stream
	until(ms: AsyncM<Stream<any>>): Stream<T> {
		return Stream.next(Maybe.just(this as Stream<T>), ms.fmap(s => Stream.pure(s))).join();
	}

	static fetch<A>(s: Stream<AsyncM<A>>): Stream<A> {
		const m = AsyncM.liftIO<Channel<AsyncM<A>>>(k => k(new Channel())).bind(c => {
			const w = s.bind(m => m.spawn().liftS()).run(m1 => c.write(m1)).fork();
			// We don't use the progress 'p' here but do we need to cancel it later?
			return w.bind(p => AsyncM.liftIO<AsyncM<A>>(k => k(c.read())).join().repeatA());
		})

		return Stream.next(Maybe.nothing, m)
	}

	//FIXME
	// convert a stream of requests to a stream of responses
	//
	// fetch :: Stream (AsyncM a) -> Stream a
	fetch<A>(): T extends AsyncM<A> ? Stream<A> : never {
		let thism = this as unknown as Stream<AsyncM<A>>;
		return Stream.fetch(thism) as any;
	}

	// return 'sum (dt) / n' after 'n' milliseconds, where 'this' is a stream of (dt, a) pairs 
	//
	// speed :: Stream (Time, a) -> Time -> AsyncM Float
	speed(n: number) {
		let thism = this as unknown as Stream<[number, T]>;
		return thism.fmap(([dt, _]) => (t: number) => t + dt).fold(n)(0).fmap((t: number) => t / n);
	}

	// test whether the speed should be adjusted after a 'duration' using the indicator function 'f'
	//
	// speedControl :: Stream (Time, a) -> Time -> (Double -> Int) -> AsyncM Bool
	// f(x) ==  0 means no change (right speed)
	// f(x) ==  1 means True (too fast)
	// f(x) == -1 means False (too slow)
	speedControl(duration: Duration): (f: Func<number, number>) => AsyncM<boolean> {
		return (f) => {
			const ms: AsyncM<boolean> = AsyncM.timeout(duration).bind(_ =>
				this.speed(duration).bind(x => {
					// console.log(x); 
					const d = f(x)
					return (d == 0) ? ms : AsyncM.pure(d == 1);
				})
			)
			return ms;
		}
	}

	// convert 'this' stream to a pull signal
	push2pull(): AsyncM<Signal<T>> { 
		return AsyncM.liftIO<Channel<T>>(k => k(new Channel<T>())).bind(c =>
			this.run(x => c.write(x)).fork().bind(p =>
				AsyncM.pure(new Signal(() => c.read())))
		);
	}

	// convert a stream of requests to a signal
	//
	// fetchG :: Stream (AsyncM a) -> AsyncM (Signal a)
	fetchG(): AsyncM<Signal<T>> {
		let thism = this as unknown as Stream<AsyncM<T>>;
		return thism.fetch<T>().push2pull();
	}

	static next = <A>(a: Maybe<A>, m: AsyncM<Stream<A>>): Stream<A> => new Next(a, m);

	static end  = <A>(a: Maybe<A>): Stream<A> => new End(a);

	static pure = <A>(x: A): Stream<A> => Stream.end(Maybe.just(x));

	// emits a number from 1 to n every 'dt' milliseconds 
	static interval = (dt: Duration, n: number): Stream<number> => {
		const h = (x: number): AsyncM<Stream<number>> =>
			(x >= n)
			? AsyncM.pure(Stream.end(Maybe.just(x)))
			: AsyncM.ifAlive.bind(_ =>
				AsyncM.pure(
					Stream.next(Maybe.just(x),
						AsyncM.timeout(dt).bind(_ => h(x + 1)))));

		return Stream.next(Maybe.nothing, AsyncM.timeout(0).bind(_ => h(1)));
	}

	// an indirect way to make an interval
	static interval_ = (dt: Duration, n: number): Stream<number> =>
		Stream.forever(dt).zipWithIndex(0).fmap(([i, _]) => i).take(n);

	// emit unit every 'dt' millisecond forever.
	static forever = (dt: Duration): Stream<Unit> => AsyncM.timeout(dt).repeatS();

	// return a finite stream with elements in 'lst' 
	static fromList = <T>(lst: T[]): Stream<T> => {
		if (lst.length == 0) { return Stream.end(Maybe.nothing); }
		else {
			let [a, ...b] = lst
			return Stream.next(Maybe.just(a), AsyncM.pure(Stream.fromList(b)));
		}
	}

	// converts a stream of requests (of the sampling period 'dt' and latency 'delay') to a stream of (dt, a) pairs
	//
	// request :: (Time -> AsyncM a) -> Time -> Time -> Stream (Time, a)
	static request =
		<A>(async_fun: Func<Duration, AsyncM<A>>) =>
		(dt: Duration) =>
		(delay: Duration): Stream<[Duration, A]> =>
			Stream.forever(delay).fmap(_ => async_fun(dt)).fetch<A>().fmap(x => [dt, x]);


	// control the speed of a stream of requests by adjusting the sampling rate 'dt' using the 'adjust' function
	//
	// control :: (t -> Stream (AsyncM a)) -> Int -> t -> (Bool -> t -> t) -> Stream (t, a) 
	static control =
		<A>(req_fun: Func<Duration, Stream<AsyncM<A>>>) =>
		(duration: Duration) =>
		(dt: Duration) =>
		(adjust: Func<boolean, Func<Duration,Duration>>): Stream<[Duration, A]> => {
			const h = (dt: Duration) =>
				req_fun(dt).multicast_().bind(([request, p1]) =>
					request.fetch<A>().multicast_().bind(([response, p2]) => {

						const mss: AsyncM<Stream<Stream<[Duration, A]>>> = AsyncM.timeout(duration).bind(_ =>
							AsyncM.all(response.count(duration))(request.count(duration))
								.bind(([x, y]) => {
									console.log(x,y); 
									if (x == y) { return mss; }
									else {
										p1.cancelP();
										p2.cancelP();
										return AsyncM.pure(h(adjust(x < y)(dt)));
									}
								})
						);

						return Stream.next(Maybe.just(response.fmap(<R>(x:R): [number, R] => [dt, x])), mss);
					}));

			return h(dt).join();
		};

	// converts a  stream of requests (of the sampling period 'dt') to an Event Siganl
	//
	// fetchE  :: (Time -> Stream (AsyncM a)) -> Time -> AsyncM (Event a)
	static fetchE = <A>(req_fun: Func<Duration, Stream<AsyncM<A>>>) =>
		(dt: Duration) =>
			req_fun(dt).fetch().fmap(x => [dt, x]).push2pull()
}

// apply each event in 'this' to each event in 'sx'
function combineLatest<T,R>(sf: Stream<Func<T,R>>, sx: Stream<T>): Stream<R> {
	const _appF = (sf: Stream<Func<T,R>>) => (sx: Stream<T>) =>
		sf.match
			(f => _appX(f)(sx))
			((f, mf) => _appFX(f, mf)(sx))

	const _appX = (f:Maybe<Func<T,R>>) => (sx:Stream<T>): Stream<R> =>
		sx.match
			(x => Stream.end(f.app(x)))
			((x, mx) => Stream.next(f.app(x), mx.fmap(sx => _appX(f)(sx))))

	const _appFX = (f: Maybe<Func<T,R>>, mf: AsyncM<Stream<Func<T,R>>>) => (sx: Stream<T>): Stream<R> => sx.match
		(x => Stream.next(f.app(x), mf.fmap(sf => _appF(sf)(sx))))
		((x, mx) => Stream.next(f.app(x),
			mf.spawn().bind(mf1 =>
				mx.spawn().bind(mx1 =>
					AsyncM.any(mf1)(mx1).bind(r => AsyncM.pure(
						r.either(sf => _appF(sf)(Stream.next(x, mx1)))
							(sx => _appFX(f, mf1)(sx))
					))))))

	return _appF(sf)(sx);
}

class End<T> extends Stream<T> {
	constructor(a: Maybe<T>) { super(a); }

	// pattern match 'End' case
	match<R>(f_end: (a: Maybe<T>) => R) { return () => f_end(this.maybe_a); }
}

class Next<T> extends Stream<T> {
	next: AsyncM<Stream<T>>;

	constructor(a: Maybe<T>, m: AsyncM<Stream<T>>) {
		super(a);
		this.next = m;
	}

	// pattern match 'Next' case
	match<R>() { return (f_next: (a: Maybe<T>, b: AsyncM<Stream<T>>) => R) => f_next(this.maybe_a, this.next); }
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

class Signal<T> {
	run: () => Promise<T>;

	// run :: (a -> IO ()) -> IO ()
	// run :: _ -> Promise a
	constructor(run: () => Promise<T>) {
		this.run = run;
	}

	static pure = <T>(a: T) => new Signal(() => Promise.resolve(a))

	// f <$> this
	fmap<R>(f: (a: T) => R): Signal<R> { return new Signal(() => this.run().then(f)); }

	// this <*> gx
	app<A>(gx: Signal<A>): SignalAppResult<T,A> {
		let thism = this.fmap(ensureFunction);
		return new Signal(() => Promise.all([thism.run(), gx.run()]).then(([f, x]) => f(x))) as any;
	}

	// run a signal as a stream with added 'delay' between events
	reactimate(delay: number): Stream<T> {
		const h: AsyncM<Stream<T>> = AsyncM.timeout(delay).bind(_ =>
			AsyncM.ifAlive.bind(_ =>
				AsyncM.liftIO_(this.run()).bind(a =>
					AsyncM.pure(Stream.next(Maybe.just(a), h))
				)
			)
		)
		return Stream.next(Maybe.nothing, h)
	}
}

// The following two methods only make sense for 'Signal (Time, a)' (i.e. 'Event a')

// convert an Event Signal to a Behavior using a summary function 
//
// stepper :: Signal (Time, a) -> ([(Time, a)] -> a) -> Behavior a	
function stepper<A>(s: Signal<[Duration, A]>, summary: Func<[Duration, A][], A>): Behavior<A> {
	let leftover: [Duration, A] | null = null;
	const f = (lst: [Duration, A][]) => (lst.length == 1) ? lst[0][1] : summary(lst);

	const h = async (dt: Duration) => {
		let lst: [Duration, A][] = [];

		if (leftover == null) { leftover = await s.run(); }
		let [dt1, a] = leftover;

		while (dt > dt1) {
			lst.push([dt1, a]);
			dt = dt - dt1;
			[dt1, a] = await s.run();
		}
		leftover = (dt == dt1) ? null : [dt1 - dt, a];

		lst.push([dt, a]);

		return f(lst);
	};

	return new Behavior(h);
}

// convert an Event Signal of batches to an Event Signal of samples
//
// unbatch :: Signal (Time, [a]) -> Signal (Time, a)
function unbatch<A>(s: Signal<[Duration, A[]]>): Signal<[Duration, A]> {
	let leftover: [Duration, A[]] | null = null;

	let h = async (): Promise<[Duration, A]> => {
		if (leftover == null) { leftover = await s.run(); }
		let [dt, lst] = leftover;

		const a: A = lst.shift()!;

		if (lst.length == 0) { leftover = null; }

		return [dt, a];
	}
	return new Signal(h);
}


/*
 * The behavior class -- also imperative like the Signal class
 *
 * The run function only passes the data 'a', not a pair (a, Behavior a), to its callback parameter, 
 *
 * A behavior object should be reused to generate the next value.
 */
class Behavior<T> {
	run: (time: number) => Promise<T>;
	// run :: Time -> (a -> IO()) -> IO()
	// run :: Time -> Promise a
	constructor(run: (time: number) => Promise<T>) {
		this.run = run;
	}

	static pure = <T>(a: T) => new Behavior(() => Promise.resolve(a))

	// f <$> this
	fmap<R>(f: (a: T) => R) { return new Behavior(dt => this.run(dt).then(x => f(x))); }

	// this <*> bx
	app<A>(bx: Behavior<A>): BehaviorAppResult<T, A> {
		let thism = this.fmap(ensureFunction);
		return new Behavior(dt => Promise.all([thism.run(dt), bx.run(dt)]).then(([f, x]) => f(x))) as any;
	}

	// run 'this' behavior as a stream with added 'delay' between events and sampling period 'dt' 
	reactimate(delay: Duration): (dt: Duration) => Stream<[Duration, T]> {
		return dt => {
			const h: AsyncM<Stream<[Duration, T]>> = AsyncM.timeout(delay).bind(_ =>
				AsyncM.ifAlive.bind(_ =>
					AsyncM.liftIO_(this.run(dt)).bind(a =>
						AsyncM.pure(Stream.next(Maybe.just([dt, a]), h))
					)
				)
			)

			return Stream.next(Maybe.nothing, h);
		}
	}

	// convert a behavior to an Event Signal of batches with 'size' number of samples and 'dt' sampling period 
	//
	// batch :: Behavior a -> Time -> Int -> Signal (Time, [a])
	batch(dt: Duration): (size: number) => Signal<[Duration, T[]]> {
		return (size: number) => new Signal(
			async () => {
				let batch : T[] = [];

				for (let i = 0; i < size; i++) {
					const x = await this.run(dt);

					batch[i] = x;
				}
				return [dt, batch];
			}
		);
	}


	// upsample :: Behavior a -> Int -> Behavior [a]
	upsample(factor: number): Behavior<T[]> {
		return new Behavior(dt =>
			this.run(dt * factor).then(a => Array(factor).fill(a)));
	}

	// downsample  :: Behavior a -> Int -> ([(Int, a)] -> a) -> Behavior a 
	downsample(factor: number): (summary: (a: [number,T][]) => T) => Behavior<T> {
		return summary => new Behavior(
			async dt => {
				const dt1 = dt / factor
				let lst: [number, T][] = [];

				for (let i = 0; i < factor; i++) {
					let x = await this.run(dt1);
					lst[i] = [dt1, x];
				}
				return summary(lst);
			});
	}


	// convert a Behavior to an Event Signal of batches with sampling period 'dt', 
	// where each batch is a sliding window created with specified 'size' and 'stride'
	//
	// windowing :: Behavior a -> Int -> Int -> Time -> Event [a]
	windowing(size: number): (stride: number) => (dt: number) => Signal<[number,T[]]> {
		return stride => dt => {
			const _lst: T[] = []; // Hack: stores the temporary window in shared variable '_lst' 

			return new Signal(async () => {
				if (_lst.length == 0) {
					// make a full window first
					for (let i = 0; i < size; i++) {
						let a = await this.run(dt);
						_lst.push(a);
					}
				}
				else {
					// make a new window for each stride
					for (let i = 0; i < stride; i++) {
						let a = await this.run(dt);
						_lst.push(a); // push new data at the end
						_lst.shift(); // pop old data in the front 
					}
				}
				return [dt * stride, _lst];
			})
		};
	}
}

