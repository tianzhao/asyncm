.PHONY: all clean
all: tests.js AsyncM.js AsyncM.d.ts

clean:
	rm -f tests.js AsyncM.d.ts AsyncM.js AsyncM.d.ts.shasum

tests.js: tests.ts AsyncM.d.ts.shasum
	tsc --lib es2015 \
	    -m commonjs \
	    --target es2015 \
	    tests.ts

AsyncM.d.ts AsyncM.js: AsyncM.ts
	tsc --lib es2015 \
	    -m commonjs \
	    --target es2015 \
	    --strict \
	    --declaration \
	    AsyncM.ts

AsyncM.d.ts.shasum: AsyncM.d.ts
	@shasum -s -c AsyncM.d.ts.shasum || \
		shasum AsyncM.d.ts >AsyncM.d.ts.shasum

