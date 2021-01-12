"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AsyncM_1 = require("./AsyncM");
/* ***********************************************************************************************
 *                       Tests
 * ***********************************************************************************************
 */
/*
const tm1 = AsyncM.interval(10, 100, x=>console.log(x));
const tm2 = AsyncM.timeout(1000)

const m1 = AsyncM.timeout (100).bind(_ => AsyncM.pure(1))
const m2 = AsyncM.timeout (200).bind(_ => AsyncM.pure(2))
const tm3 = AsyncM.any(m1)(m2)

tm1.run(Progress.nil());
*/
// Stream.interval(100, 5).run(x => console.log(x)).run(Progress.nil())(x=>x);
const s1 = AsyncM_1.Stream.interval(100, 5);
const s2 = AsyncM_1.Stream.interval(50, 10);
// s1.fmap(x => x*10).run(x => console.log(x)).run(Progress.nil())(x=>x);
// s1.bind (x => Stream.pure(x*10)).run(x => console.log(x)).run(Progress.nil())(x=>x);
const t0 = s1.bind(x => s2.bind(y => AsyncM_1.Stream.pure([x, y])));
const t1 = s1.multicast().bind(s11 => s2.multicast().bind(s21 => s11.bind(x => s21.bind(y => AsyncM_1.Stream.pure([x, y])))));
const t2 = s1.multicast().bind(s11 => s2.multicast().bind(s21 => AsyncM_1.Stream.pure((a) => (b) => [a, b]).app(s11).app(s21)));
const t3 = AsyncM_1.combineLatest(s1.fmap((a) => (b) => [a, b]), AsyncM_1.Stream.pure(10));
const t4 = AsyncM_1.combineLatest(AsyncM_1.Stream.pure((a) => [a]), s2);
const t5 = AsyncM_1.combineLatest(s1.fmap((a) => (b) => [a, b]), s2);
const t6 = s1.zip(s2);
const t7 = AsyncM_1.AsyncM.timeout(50).repeatS().take(5);
const t8 = s2.drop(5).take(5); // due to the leading Nothing event, we always miss one -- not sure how to fix
const t9 = AsyncM_1.Stream.interval_(100, 10);
const t10 = s2.stop(200);
const t11 = s2.fmap((x) => (c) => x + c).accumulate(0);
const t12 = s2.until(AsyncM_1.AsyncM.timeout(200).fmap(_ => s1));
const t13 = s1.bind(x => AsyncM_1.AsyncM.timeout(50).fmap(_ => x).liftS());
const t14 = s1.fmap(x => AsyncM_1.AsyncM.timeout(500).fmap(_ => x)).fetch();
const t15 = AsyncM_1.Stream.request(n => AsyncM_1.AsyncM.timeout(n).fmap(_ => 'data'))(500)(10).take(10);
// test adjusting sampling rate for data requests
const req_fun = (max) => AsyncM_1.Stream.forever(10)
    .fmap(_ => {
    const dt = Math.round(Math.random() * max);
    return AsyncM_1.AsyncM.timeout(dt).fmap(_ => dt);
});
const t16 = AsyncM_1.Stream.control(req_fun)(10)(20)(b => t => Math.round(b ? t / 1.1 : t * 1.1)).take_(200);
t16.run(console.log).run();
// test reactimate signal
const t17 = s1.push2pull().liftS().bind(g => g.reactimate(20));
// a summary function based on weighted average
const avg = (lst) => {
    let t = 0, sum = 0;
    for (const [dt, a] of lst) {
        t = t + dt;
        sum = sum + a * dt;
    }
    return sum / t;
};
// test stepper
const t18 = s2.fmap((x) => [50, x]) // s2 is a stream with dt = 50ms
    .until(AsyncM_1.AsyncM.timeout(200).fmap(_ => // switch fter 200 ms 
 s1.fmap(x => [100, x])) // s1 is a stream with dt = 100ms  
)
    .push2pull().liftS() // convert to event
    .bind(g => AsyncM_1.stepper(g, avg) // convert to behavior
    .reactimate(10)(40) // run it with 10m delay and 40ms sample-period
);
// test unbatch
const t19 = s2.fmap((x) => [50, Array(x).fill(x)]) // a stream of (Time, array)
    .push2pull().liftS() // convert to event
    .bind(g => AsyncM_1.unbatch(g) // unbatch
    .reactimate(10) // run it with 10ms delay
);
// test downsample
const t20 = s2.fmap((x) => [50, x])
    .push2pull().liftS()
    .bind(g => AsyncM_1.stepper(g, avg) // convert to a behavior
    .fmap(x => x * 10) // times 10
    .downsample(2)(avg) // downsample by a factor of 2
    .reactimate(10)(100) // run it with 10ms delay and 100ms sample-period
);
// test windowing
const t21 = s2.fmap((x) => [50, Array(5).fill(x)]) // a stream of batches
    .push2pull().liftS() // convert to an event of batches
    .bind(g => {
    let b = AsyncM_1.unbatch(g); // unbatch the event
    return AsyncM_1.stepper(b, avg) // convert to a behavior
        .windowing(5)(2)(50) // make a window of size 5 and stride 2 with 50ms sample-period
        .reactimate(10);
});
// test behavior <*>
const se1 = s1.fmap((x) => [100, x]).push2pull().liftS();
const se2 = s2.fmap((x) => [50, x]).push2pull().liftS();
const t22 = se1.bind(e1 => se2.bind(e2 => {
    const b1 = AsyncM_1.stepper(e1, avg);
    const b2 = AsyncM_1.stepper(e2, avg);
    const b = AsyncM_1.Behavior.pure((x) => (y) => [x, y]).app(b1).app(b2);
    return b.reactimate(10)(25);
}));
const t23 = s2.fmap(x => [45, x]).speedControl(200)(r => (r > 0.9) ? 0 : -1);
// t23.run(Progress.nil()).then(x => console.log(x))
// test batch
const t24 = AsyncM_1.Stream.interval(1000, 10).fmap((x) => [10, Array(1000).fill(x)]) // a stream of (Time, Number)
    .push2pull().liftS() // convert to batch event
    .bind(g => {
    let b = AsyncM_1.unbatch(g); // convert to sample event 
    return AsyncM_1.stepper(b, avg) // convert to behavior
        .batch(100)(100) // convert to batch
        .reactimate(1); // run it with 1ms delay
});
// test zip
const t25 = AsyncM_1.Stream.interval(100, 30).multicast().bind(s1 => AsyncM_1.Stream.interval(300, 10).multicast().bind(s2 => s1.zip(s2)));
// test skip
const t26 = s2.skip(200);
// The first 'run' returns an 'AsyncM' and the second 'run' executes the 'AsyncM'.
//t5.run(x => console.log(x)).run(Progress.nil());
