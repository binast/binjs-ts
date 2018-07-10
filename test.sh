#!/bin/bash

# Round-trips a JavaScript file to check whether the decoded output
# completely represents the input. Also reports the compressed size
# relative to the compressed source.

uhoh() {
    exit 1
}

trap 'uhoh' 0

FOI="${FOI:-/home/dpc/binast/fb_bench/rsrc.php/v3iufH3/yb/l/en_US/C4ZhzGqwQ96.js}"
BROTLI_BIN="${BROTLI_BIN:-$(which brotli)}"

if [ ! -f "$BROTLI_BIN" ]; then
    echo "missing brotli"
    exit 1
fi

if [ ! -f "$FOI" ]; then
    echo "set FOI to the file to round-trip"
    exit 1
fi

if [ ! -f "$FOI.br" ]; then
    "$BROTLI_BIN" -w 20 -q 11 "$FOI" -o "$FOI.br" -f
fi

npm run build
echo encode
time npm run encode -- $FOI --dump-ast > ast-in.json
echo decode
time npm run decode -- $FOI.binjs > ast-out.json
diff ast-in.json ast-out.json | \
    awk 'NR<20 {print} {x[$1] += 1} END {for (y in x) print(y, x[y])}'

source_compressed_size_bytes=$(stat --printf="%s" "$FOI.br")
binjs_compressed_size_bytes=$("$BROTLI_BIN" -w 20 -q 11 "$FOI.binjs" -c | wc -c)
echo "compressed js    " $source_compressed_size_bytes
echo "compressed binjs " $binjs_compressed_size_bytes
