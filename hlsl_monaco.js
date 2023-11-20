// barebones HLSL language config based on CPP

export const hlsl_lang_config = {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
    ],
    autoClosingPairs: [
        { open: "[", close: "]" },
        { open: "{", close: "}" },
        { open: "(", close: ")" },
        { open: "'", close: "'", notIn: ["string", "comment"] },
        { open: '"', close: '"', notIn: ["string"] },
    ],
    surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
    ],
    folding: { markers: { start: new RegExp("^\\s*#pragma\\s+region\\b"), end: new RegExp("^\\s*#pragma\\s+endregion\\b") } },
};

export const hlsl_lang_def = {
    defaultToken: "",
    tokenPostfix: ".hlsl",
    brackets: [
        { token: "delimiter.curly", open: "{", close: "}" },
        { token: "delimiter.parenthesis", open: "(", close: ")" },
        { token: "delimiter.square", open: "[", close: "]" },
        { token: "delimiter.angle", open: "<", close: ">" },
    ],
    keywords: [
        "struct", "cbuffer", "const", "static", "typedef", "define", "packoffset", "register",
        "uniform", "ConstantBuffer", "pragma", "pack_matrix", "row_major", "column_major",
        "vector", "matrix"
    ],
    operators: ["=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "&&", "||", "++", "--", "+", "-", "*", "/", "&", "|", "^", "%", "<<", ">>", ">>>", "+=", "-=", "*=", "/=", "&=", "|=", "^=", "%=", "<<=", ">>=", ">>>="],
    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    escapes: /\\(?:[0abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    integersuffix: /([uU](ll|LL|l|L)|(ll|LL|l|L)?[uU]?)/,
    floatsuffix: /[fFlL]?/,
    encoding: /u|u8|U|L/,
    tokenizer: {
        root: [
            [/@encoding?R\"(?:([^ ()\\\t]*))\(/, { token: "string.raw.begin", next: "@raw.$1" }],
            [/[a-zA-Z_]\w*/, { cases: { "@keywords": { token: "keyword.$0" }, "@default": "identifier" } }],
            [/^\s*#\s*include/, { token: "keyword.directive.include", next: "@include" }],
            [/^\s*#\s*\w+/, "keyword.directive"],
            { include: "@whitespace" },
            [/\[\s*\[/, { token: "annotation", next: "@annotation" }],
            [/[{}()\[\]]/, "@brackets"],
            [/[<>](?!@symbols)/, "@brackets"],
            [/@symbols/, { cases: { "@operators": "delimiter", "@default": "" } }],
            [/\d*\d+[eE]([\-+]?\d+)?(@floatsuffix)/, "number.float"],
            [/\d*\.\d+([eE][\-+]?\d+)?(@floatsuffix)/, "number.float"],
            [/0[xX][0-9a-fA-F']*[0-9a-fA-F](@integersuffix)/, "number.hex"],
            [/0[0-7']*[0-7](@integersuffix)/, "number.octal"],
            [/0[bB][0-1']*[0-1](@integersuffix)/, "number.binary"],
            [/\d[\d']*\d(@integersuffix)/, "number"],
            [/\d(@integersuffix)/, "number"],
            [/[;,.]/, "delimiter"],
            [/"([^"\\]|\\.)*$/, "string.invalid"],
            [/"/, "string", "@string"],
            [/'[^\\']'/, "string"],
            [/(')(@escapes)(')/, ["string", "string.escape", "string"]],
            [/'/, "string.invalid"],
        ],
        whitespace: [
            [/[ \t\r\n]+/, ""],
            [/\/\*\*(?!\/)/, "comment.doc", "@doccomment"],
            [/\/\*/, "comment", "@comment"],
            [/\/\/.*\\$/, "comment", "@linecomment"],
            [/\/\/.*$/, "comment"],
        ],
        comment: [
            [/[^\/*]+/, "comment"],
            [/\*\//, "comment", "@pop"],
            [/[\/*]/, "comment"],
        ],
        linecomment: [
            [/.*[^\\]$/, "comment", "@pop"],
            [/[^]+/, "comment"],
        ],
        doccomment: [
            [/[^\/*]+/, "comment.doc"],
            [/\*\//, "comment.doc", "@pop"],
            [/[\/*]/, "comment.doc"],
        ],
        string: [
            [/[^\\"]+/, "string"],
            [/@escapes/, "string.escape"],
            [/\\./, "string.escape.invalid"],
            [/"/, "string", "@pop"],
        ],
        raw: [
            [
                /(.*)(\))(?:([^ ()\\\t"]*))(\")/,
                { cases: { "$3==$S2": ["string.raw", "string.raw.end", "string.raw.end", { token: "string.raw.end", next: "@pop" }], "@default": ["string.raw", "string.raw", "string.raw", "string.raw"] } },
            ],
            [/.*/, "string.raw"],
        ],
        annotation: [{ include: "@whitespace" }, [/using|alignas/, "keyword"], [/[a-zA-Z0-9_]+/, "annotation"], [/[,:]/, "delimiter"], [/[()]/, "@brackets"], [/\]\s*\]/, { token: "annotation", next: "@pop" }]],
        include: [
            [/(\s*)(<)([^<>]*)(>)/, ["", "keyword.directive.include.begin", "string.include.identifier", { token: "keyword.directive.include.end", next: "@pop" }]],
            [/(\s*)(")([^"]*)(")/, ["", "keyword.directive.include.begin", "string.include.identifier", { token: "keyword.directive.include.end", next: "@pop" }]],
        ],
    },
};

if (typeof window.HLSL_init_ran === "undefined") {

    window.HLSL_init_ran = true;

    const scalar_typenames = [
        "float16_t", "float32_t", "float64_t",
    /*"int8_t", "uint8_t",*/ "int16_t", "uint16_t", "int32_t", "uint32_t", "int64_t", "uint64_t",
        "float", "int", "uint", "double", "bool",
        "min12int", "min16int", "min16uint", "min10float", "min16float", "half"];

    function GenerateVectorAndMatrixTypes(scalar_type) {
        const types = [];
        types.push(scalar_type);
        for (let i = 1; i < 5; ++i) {
            for (let j = 1; j < 5; ++j) {
                types.push(`${scalar_type}${i}x${j}`);
            }
            types.push(`${scalar_type}${i}`);
        }
        return types;
    }

    for (let scalar_type of scalar_typenames) {
        let types = GenerateVectorAndMatrixTypes(scalar_type);
        for (let t of types) {
            hlsl_lang_def.keywords.push(t);
        }
    }
}