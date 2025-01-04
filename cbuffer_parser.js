const scalar_typenames = [
    "float16_t", "float32_t", "float64_t",
    /*"int8_t", "uint8_t",*/ "int16_t", "uint16_t", "int32_t", "uint32_t", "int64_t", "uint64_t",
    "float", "int", "uint", "double", "bool", // NOTE: put these at the bottom since the previous ones have these as prefixes
    "min12int", "min16int", "min16uint", "min10float", "min16float", "half"
];
const typenames_unsupported = [
    "min12int", "min16int", "min16uint", "min10float", "min16float", "half"
];
const keywords_unsupported = [ // TODO: support these keywords
    "define", "packoffset", "uniform", "pragma", "pack_matrix"
];
const tokens_unsupported = [
    '#'
];

// TODO: for packoffset:
//  - save "forced offset" in parser
//  - first pass through layouting saves all forced offset variables in one array
//  - whenever we layout the next variable, we need to loop through all forced offset vars to figure out whether we need to pad
//  - whenever we calculate padding, we loop through all forced offset variables in addition to the last non-forced variable
//  - this is based on an incomplete understanding of packoffset, make some examples and check how they affect padding
//  - maybe we can do one pass layouting *only* the forced offset vars and then a second pass doing everything else? like a "shadow struct" overlaid on top?

export const TokenType = {
    Identifier: "identifier",
    Number: "number",
    Keywords: {
        CBuffer: "cbuffer", // NOTE: these must exactly match the keywords, at least on the right side
        Struct: "struct",
        Column_Major: "column_major",
        Row_Major: "row_major",
        ConstantBuffer: "ConstantBuffer",
        StructuredBuffer: "StructuredBuffer",
        Register: "register",
        Typedef: "typedef",
        //    Define: "define",
        //    PackOffset: "packoffset",
        //    Uniform: "uniform",
        //    Pragma: "pragma",
        //    Pack_Matrix: "pack_matrix"
    },
    '(': '(',
    ')': ')',
    '{': '{',
    '}': '}',
    '[': '[',
    ']': ']',
    '<': '<',
    '>': '>',
    ',': ',',
    ';': ';',
    ':': ':',
    '#': '#'
};

export function GetSupportedKeywords() {
    let ret = [];
    for (const [key, value] of Object.entries(TokenType.Keywords)) {
        ret.push(value);
    }
    return ret;
}

function GetKeyByValue(object, value) {
    return Object.keys(object).find(key => object[key] === value);
}
function IsDigit(c) {
    return c[0] >= '0' && c[0] <= '9';
}

export class HLSLError {
    constructor(message, line, start_column, end_column = start_column + 1) {
        this.message = message;
        this.line = line;
        this.start_column = start_column;
        this.end_column = end_column;
    }
    static CreateFromToken(message, token) {
        return new HLSLError(message, token.line, token.column, token.column + token.value.length);
    }
};

export class Token {
    constructor(type, value, line, column) {
        this.type = type;
        this.value = value;
        this.line = line;
        this.column = column;
    }
};

export class Lexer {
    constructor(input) {
        this.input = input;
        this.index = -1;
        this.line = 1;
        this.column = 0;
        this.curstring = "";
    }
    SkipWhitespace() {
        let char = '\0';
        do {
            char = this.PeekNext();
        } while (/\s/.test(char) && this.Consume());
    }
    SkipLineComment() {
        let char = '\0';
        do {
            char = this.GetNext();
        } while (char != '\n' && char != '\0');
    }
    SkipMultiLineComment() {
        while (true) {
            let char = this.GetNext();
            let next = this.PeekNext();
            if (char == '*' && next == '/') {
                this.Consume();
                return true;
            }
            else if (next == '\0')
                return false;
        }
        return false;
    }
    GetNext() {
        if (this.CharactersLeft() > 0) {
            return this.Consume();
        }
        return '\0';
    }
    PeekNext() {
        if (this.CharactersLeft() > 0)
            return this.input[this.index + 1];
        return '\0';
    }
    Consume() {
        this.index++;
        this.curstring = this.input.slice(this.index);
        let char = this.input[this.index];
        this.column++;
        if (char == '\n') {
            this.line += 1;
            this.column = 0;
        }
        return char;
    }
    CharactersLeft() {
        let ret = this.input.length - this.index - 1;
        return ret;
    }
    MakeToken(type, value, column = this.column) {
        return new Token(type, value, this.line, column);
    }
    GetAllTokens() {
        let tokens = [];
        while (this.CharactersLeft() > 0) {

            this.SkipWhitespace();

            if (this.CharactersLeft() == 0)
                return tokens;

            let char = this.GetNext(); // NOTE: in hindsight, this almost certainly should have been a Peek, but it works now so I'm leaving it

            if (TokenType.hasOwnProperty(char)) { // single character tokens like (){}[],;
                tokens.push(this.MakeToken(char, char));
            }
            else if (char == '/') {
                if (this.CharactersLeft() < 1)
                    throw new HLSLError(`unexpected token at end of input ${char}`, this.line, this.column);

                let next = this.GetNext();
                if (next == '/')
                    this.SkipLineComment();
                else if (next == '*') {
                    let start_column = this.column;
                    let start_line = this.line;
                    if (!this.SkipMultiLineComment())
                        throw new HLSLError(`unterminated multi-line comment`, start_line, start_column);
                }
                else {
                    throw new HLSLError(`unexpected token ${char}${next}`, this.line, this.column);
                }
            }
            else {
                let token = "";
                let start_column = this.column;
                let is_number = false;
                if (/\d/.test(char)) { // number
                    is_number = true;
                    do {
                        token += char;
                        char = this.PeekNext();
                    } while (/\d/.test(char) && this.Consume()); // aaaaaaaaaaaaaaaaa
                }
                else if (/\w/.test(char)) { // identifier/keyword
                    do {
                        token += char;
                        char = this.PeekNext();
                    } while (/\w/.test(char) && this.Consume()); // aaaaaaaaaaaaaaaaa
                }
                if (token != "") {
                    if (is_number)
                        tokens.push(this.MakeToken(TokenType.Number, token, start_column));
                    else if (GetKeyByValue(TokenType.Keywords, token))
                        tokens.push(this.MakeToken(token, token, start_column));
                    else
                        tokens.push(this.MakeToken(TokenType.Identifier, token, start_column));
                }
                else {
                    throw new HLSLError(`invalid or unexpected token ${char}`, this.line, start_column);
                }
            }
        }
        return tokens;
    }
};

export class MemberVariable {
    constructor(type, name) {
        this.type = type;
        this.name = name;
        this.isCBuffer = false;
        this.isSBuffer = false;
    }
};

export class StructType {
    constructor(name, members) {
        this.name = name;
        this.members = members;
    }
};

export class ArrayType {
    constructor(elementType, arraySize, created_from_matrix = false) {
        this.elementType = elementType;
        this.arraySize = arraySize;
        this.name = `${elementType.name}[${arraySize}]`;
        this.created_from_matrix = created_from_matrix;
    }
};

export class BuiltinType {
    constructor(name, elementsize, alignment, vectorsize, created_from_matrix = false) {
        this.name = name;
        this.elementsize = elementsize;
        this.alignment = alignment;
        this.vectorsize = (vectorsize == undefined) ? 1 : vectorsize;
        this.created_from_matrix = created_from_matrix;
    }
    static Create(type, vectorsize, force_c_types, created_from_matrix = false) {
        if (type == "bool" && force_c_types) // rename "bool" to "BOOL" for C layout to indicate 4 byte type
            type = "BOOL";
        let t = types_builtin[type];
        return new BuiltinType(vectorsize == 1 ? t.name : t.name + vectorsize, t.elementsize, t.alignment, vectorsize, created_from_matrix);
    }
};

class Typedef {
    constructor(type, name) {
        this.type = type;
        this.name = name;
    }
};

const types_builtin = {
    "float": new BuiltinType("float", 4, 4),
    "float16_t": new BuiltinType("float16_t", 2, 2),
    "float32_t": new BuiltinType("float32_t", 4, 4),
    "float64_t": new BuiltinType("float64_t", 8, 8),
    //"int8_t"    : new BuiltinType("int8_t"   , 1, 1),
    //"uint8_t"   : new BuiltinType("uint8_t"  , 1, 1),
    "int16_t": new BuiltinType("int16_t", 2, 2),
    "uint16_t": new BuiltinType("uint16_t", 2, 2),
    "int32_t": new BuiltinType("int32_t", 4, 4),
    "uint32_t": new BuiltinType("uint32_t", 4, 4),
    "int64_t": new BuiltinType("int64_t", 8, 8),
    "uint64_t": new BuiltinType("uint64_t", 8, 8),
    "float": new BuiltinType("float", 4, 4),
    "int": new BuiltinType("int", 4, 4),
    "uint": new BuiltinType("uint", 4, 4),
    "double": new BuiltinType("double", 8, 8),
    "bool": new BuiltinType("bool", 4, 4),
    "BOOL": new BuiltinType("BOOL", 4, 4), // NOTE: for C layouts
};

export class Parser {
    constructor(lexer, force_c_types) {
        this.index = -1;
        this.lexer = lexer;
        this.tokens = lexer.GetAllTokens();
        this.curToken = null;
        this.nextToken = this.tokens[this.index + 1] ?? null;
        this.buffers = [];
        this.typedefs = [];
        this.counter = 0;
        this.force_c_types = force_c_types;
    }
    GetNext() {
        return this.Consume();
    }
    PeekNext() {
        return this.nextToken;
    }
    Consume() {
        this.index++;
        this.curToken = this.tokens[this.index] ?? null;
        this.nextToken = this.tokens[this.index + 1] ?? null;
        return this.curToken;
    }
    Unconsume() {
        this.index--;
        this.curToken = this.tokens[this.index] ?? null;
        this.nextToken = this.tokens[this.index + 1] ?? null;
        return this.curToken;
    }
    TokensLeft() {
        let ret = this.tokens.length - this.index - 1;
        return ret;
    }
    CheckSupport(token) {
        if (keywords_unsupported.indexOf(token.value) != -1)
            throw HLSLError.CreateFromToken(`unsupported keyword '${token.value}'`, token);
        else if (tokens_unsupported.indexOf(token.type) != -1)
            throw HLSLError.CreateFromToken(`unsupported token ${token.type}`, token);
    }
    ExpectAny(...types) {
        let ret = null;
        for (let t of types) {
            if (ret = this.Accept(t))
                return ret;
        }
        // error
        let lastToken = this.curToken;
        let token = this.nextToken;
        let error = "expected ";
        for (let t of types) {
            error += `${t} or `;
        }
        error = error.substring(0, error.length - 4); // remove superfluous " or "
        let lastToken_str = lastToken ? ` after '${lastToken.value}' (line ${lastToken.line})` : "";
        let token_str = "";
        if (!token)
            token_str = "end of file";
        else if (token.type == TokenType.Identifier || token.type == TokenType.Number)
            token_str = `${token.type} '${token.value}'`;
        else
            token_str = `${token.type}`;

        error += `${lastToken_str} but got ${token_str}`;
        if (!token)
            throw new HLSLError(error, this.lexer.line, 1, this.lexer.input.length - this.lexer.input.lastIndexOf('\n'));
        else
            throw HLSLError.CreateFromToken(error, token);
    }
    Expect(type) {
        let lastToken = this.curToken;
        let token = this.GetNext();

        if (!token)
            throw new HLSLError(`expected ${type}, but got end of file`, this.lexer.line, 1, this.lexer.input.length - this.lexer.input.lastIndexOf('\n'));

        this.CheckSupport(token);

        if (token.type != type) {
            let lastToken_str = lastToken ? ` after '${lastToken.value}' (line ${lastToken.line})` : "";
            if (token.type == TokenType.Identifier || token.type == TokenType.Number)
                throw HLSLError.CreateFromToken(`expected ${type}${lastToken_str} but got ${token.type} '${token.value}'`, token);
            else
                throw HLSLError.CreateFromToken(`expected ${type}${lastToken_str} but got ${token.type}`, token);
        }
        return token;
    }
    AcceptAny(...types) {
        let ret = null;
        for (let t of types) {
            if (ret = this.Accept(t))
                return ret;
        }
        return ret;
    }
    Accept(type) {
        let token = this.PeekNext();

        if (!token)
            return null;

        this.CheckSupport(token);

        if (token.type != type)
            return null;

        return this.Consume();
    }
    MakeAnonymousName() {
        return "_anon" + this.counter++;
    }
    ParseInteger() {
        let str = this.Expect(TokenType.Number).value;
        if (String(Number(str)) != str)
            throw HLSLError.CreateFromToken(`invalid integer ${str}`, this.curToken);
        return Number(str);
    }
    CheckSize(size, sizestr, name, min = 1, max = 4) {
        if (!(size >= min && size <= max)) // negated test to catch NaN
            throw HLSLError.CreateFromToken(`invalid ${name} '${sizestr}' (must be between ${min} and ${max} inclusive)`, this.curToken);
    }
    AddTypedef(type, name) {
        if (this.typedefs.find((e) => e.name == name)) {
            throw HLSLError.CreateFromToken(`redefinition of type '${name}'`, this.curToken);
        }
        this.typedefs.push(new Typedef(type, name));
    }
    ParseOptionalRegisterBinding() {
        if (this.Accept(':')) {
            this.Expect(TokenType.Keywords.Register);
            this.Expect('(');
            this.Expect(TokenType.Identifier); // not going to check whether this is a correct register, we're not a compiler
            if (this.Accept(','))
                this.Expect(TokenType.Identifier); // same here
            this.Expect(')');
        }
    }
    ParseFile() {
        do {
            let token_type = this.ExpectAny(
                TokenType.Keywords.Struct,
                TokenType.Keywords.CBuffer,
                TokenType.Keywords.ConstantBuffer,
                TokenType.Keywords.StructuredBuffer,
                TokenType.Keywords.Typedef).type;

            if (token_type == TokenType.Keywords.Typedef) {
                let local_typedefs = [];
                this.ParseMemberVariableIntoArray(local_typedefs); // typedefs are syntactically like member variable declarations you can have multiple names using comma
                for (let t of local_typedefs) {
                    AddTypedef(t.type, t.name);
                }
            }
            else { // type / variable declaration (struct, cbuffer, ConstantBuffer, StructuredBuffer)
                let type_declaration = null;
                let variable_name_token = null;

                // ConstantBuffer<T>, where T must be a previously defined struct (not inline, not a scalar/vector, etc.)
                if (token_type == TokenType.Keywords.ConstantBuffer) {
                    this.Expect('<');
                    let template_type_name_token = this.Expect(TokenType.Identifier);

                    type_declaration = this.typedefs.find((element) => element.name == template_type_name_token.value)?.type;

                    if (!type_declaration) {
                        // try to see if it's a valid type name, but not a struct
                        this.Unconsume();
                        type_declaration = this.ParseNonStructType();
                        if (!type_declaration)
                            throw HLSLError.CreateFromToken(`cannot find type named '${template_type_name_token.value}'`, template_type_name_token);
                    }

                    if (!(type_declaration instanceof StructType))
                        throw HLSLError.CreateFromToken(`template type '${template_type_name_token.value}' must be a struct type (is '${type_declaration.constructor.name}')`, template_type_name_token);

                    this.Expect('>');

                    variable_name_token = this.Expect(TokenType.Identifier);
                    while (this.Accept('[')) {
                        this.ParseInteger();
                        this.Expect(']');
                    }
                    this.ParseOptionalRegisterBinding();

                    // make things slightly more consistent between cbuffer and ConstantBuffer by making an inner struct declaration
                    type_declaration = new StructType(variable_name_token.value, [new MemberVariable(type_declaration, "")]);
                }
                else if (token_type == TokenType.Keywords.StructuredBuffer) { // StructuredBuffer<T>, accepts any type T except inline struct definitions
                    this.Expect('<');
                    let template_type = this.ParseNonStructType(); // NOTE: unlike the name implies, this can still return a struct type defined elsewhere, just not inline structs
                    if (!template_type)
                        throw HLSLError.CreateFromToken(`cannot find type named '${this.curToken.value}'`, this.curToken);
                    this.Expect('>');
                    
                    variable_name_token = this.Expect(TokenType.Identifier);
                    while (this.Accept('[')) {
                        this.ParseInteger();
                        this.Expect(']');
                    }
                    this.ParseOptionalRegisterBinding();

                    // put template type into outer struct for the buffer
                    type_declaration = new StructType(variable_name_token.value, [new MemberVariable(template_type, "")]);
                }
                else if (token_type == TokenType.Keywords.Struct) { // struct declaration
                    type_declaration = this.ParseStructTypeDeclaration(true);
                    variable_name_token = this.Accept(TokenType.Identifier);
                    while (this.Accept('[')) {
                        this.ParseInteger();
                        this.Expect(']');
                    }
                }
                else if (token_type == TokenType.Keywords.CBuffer) { // cbuffer declaration
                    type_declaration = this.ParseStructTypeDeclaration(true, true);
                }

                if (token_type == TokenType.Keywords.CBuffer)
                    this.Accept(';');
                else
                    this.Expect(';');

                if (token_type == TokenType.Keywords.CBuffer || token_type == TokenType.Keywords.ConstantBuffer || token_type == TokenType.Keywords.StructuredBuffer) {
                    // treat top level declarations as "member variables" of the global scope so we can get their variable names
                    let global_member = new MemberVariable(type_declaration, variable_name_token ? variable_name_token.value : "");
                    global_member.isCBuffer = (token_type == TokenType.Keywords.CBuffer || token_type == TokenType.Keywords.ConstantBuffer);
                    global_member.isSBuffer = token_type == TokenType.Keywords.StructuredBuffer;
                    this.buffers.push(global_member);
                }
            }

        } while (this.TokensLeft() > 0);

        return this.buffers;
    }
    ParseStructTypeDeclaration(is_top_level = false, is_cbuffer = false) {
        let type_name = is_top_level ? this.Expect(TokenType.Identifier).value : this.Accept(TokenType.Identifier)?.value;

        if (is_cbuffer)
            this.ParseOptionalRegisterBinding();

        this.Expect('{');
        let members = [];
        while (!this.Accept('}')) {
            this.ParseMemberVariableIntoArray(members);
        }
        let struct = new StructType(type_name ?? this.MakeAnonymousName(), members);
        if (!is_cbuffer && type_name) {
            // TODO: Technically I'd need to know the parent and use Parent::Child as name for the typedef if applicable, but the code is already complicated enough.
            //       For lookup I'd also need to do the locally nested types first, they have precedence over global definitions.
            this.AddTypedef(struct, struct.name);
        }
        return struct;
    }
    ParseMemberVariableIntoArray(members) {
        let member_type = this.ParseMemberType();
        if (!member_type)
            throw HLSLError.CreateFromToken(`cannot find type named '${this.curToken.value}'`, this.curToken);

        do {
            let member_name = this.Expect(TokenType.Identifier).value;

            if (this.Accept('[')) {
                let array_type = this.ParseArrayType(member_type);
                members.push(new MemberVariable(array_type, member_name));
            }
            else {
                members.push(new MemberVariable(member_type, member_name));
            }

        } while (this.Accept(','));

        this.Expect(';');
    }
    ParseMemberType() {
        if (this.Accept(TokenType.Keywords.Struct)) // inner structs
            return this.ParseStructTypeDeclaration();
        else
            return this.ParseNonStructType();
    }
    ParseNonStructTypeImpl(is_row_major) {
        let name = this.Expect(TokenType.Identifier).value;
        if (name == "matrix" || name == "vector") {
            return this.ParseTemplateType(name, is_row_major);
        }
        for (let t of scalar_typenames) {
            if (name.startsWith(t)) {
                if (name == t) {
                    if (typenames_unsupported.indexOf(t) != -1) throw HLSLError.CreateFromToken(`unsupported type '${this.curToken.value}'`, this.curToken);
                    return BuiltinType.Create(t, 1, this.force_c_types);
                }

                let suffix = name.substring(t.length);
                if (suffix.length == 1 && IsDigit(suffix[0])) {
                    let vectorsize = Number(suffix[0]);
                    this.CheckSize(vectorsize, suffix[0], "vector size");
                    if (typenames_unsupported.indexOf(t) != -1) throw HLSLError.CreateFromToken(`unsupported type '${this.curToken.value}'`, this.curToken);
                    return BuiltinType.Create(t, vectorsize, this.force_c_types);
                }
                else if (suffix.length == 3 && IsDigit(suffix[0]) && suffix[1] == 'x' && IsDigit(suffix[2])) {
                    let rows = Number(suffix[0]);
                    let cols = Number(suffix[2]);
                    this.CheckSize(rows, suffix[0], "matrix row size");
                    this.CheckSize(cols, suffix[2], "matrix column size");

                    let vectorsize = is_row_major ? cols : rows;
                    let arraysize = is_row_major ? rows : cols;
                    if (typenames_unsupported.indexOf(t) != -1) throw HLSLError.CreateFromToken(`unsupported type '${this.curToken.value}'`, this.curToken);
                    let vector_type = BuiltinType.Create(t, vectorsize, this.force_c_types, true);
                    if (arraysize == 1)
                        return vector_type; // typeNx1 matrices are layout equivalent to just typeN, not typeN[1]
                    else
                        return new ArrayType(vector_type, arraysize, true);
                }
            }
        }
        return this.typedefs.find((element) => element.name == name)?.type;
    }
    ParseNonStructType() {
        let matrix_orientation = this.AcceptAny(TokenType.Keywords.Row_Major, TokenType.Keywords.Column_Major);
        // NOTE: we already default to column major
        // TODO: allow emulating compiler flags / #pragma to change default
        let is_row_major = matrix_orientation && matrix_orientation.type == TokenType.Keywords.Row_Major;
        //let is_column_major = matrix_orientation && matrix_orientation.type == TokenType.Keywords.Column_Major;

        let type = this.ParseNonStructTypeImpl(is_row_major);

        // I need to do this check with a boolean tag instead of a separate MatrixType because a matrix can be equivalent to either an array or vector and I want to not change all the code down the line
        if (matrix_orientation && !type.created_from_matrix)
            throw HLSLError.CreateFromToken(`cannot define ${matrix_orientation.type} for non-matrix type ${type.name}`, matrix_orientation);

        return type;
    }
    ParseTemplateType(name, is_row_major) {
        // template type arguments are optional and default to the following:
        let scalar_type = "float";
        let vectorsize = 4;
        let arraysize = 4;

        let is_matrix = (name == "matrix");
        if (this.Accept('<')) {
            let id = this.Expect(TokenType.Identifier).value;
            scalar_type = scalar_typenames.find((t) => t == id);
            if (!scalar_type) {
                let corrected = scalar_typenames.find((t) => id.includes(t));
                throw HLSLError.CreateFromToken(`invalid scalar type '${id}'${corrected ? ", did you mean " + corrected + "?" : ""}`, this.curToken);
            }

            if (this.Accept(',')) {
                vectorsize = this.ParseInteger();
                this.CheckSize(vectorsize, this.curToken.value, is_matrix ? "matrix row size" : "vector size");
            }
            if (is_matrix && this.Accept(',')) {
                arraysize = this.ParseInteger();
                this.CheckSize(arraysize, this.curToken.value, "matrix column size");
            }
            this.Expect('>');
        }

        if (is_matrix) {
            if (is_row_major) {
                let tmp = vectorsize;
                vectorsize = arraysize;
                arraysize = tmp;
            }
            let vector_type = BuiltinType.Create(scalar_type, vectorsize, this.force_c_types, true);
            if (arraysize == 1)
                return vector_type; // typeNx1 matrices are layout equivalent to just typeN, not typeN[1]
            else
                return new ArrayType(vector_type, arraysize, true);
        }
        else {
            return BuiltinType.Create(scalar_type, vectorsize, this.force_c_types);
        }
    }
    ParseArrayType(member_type) {
        let arraysize = 1;
        do { // NOTE: we just treat multi-dimensional arrays as one-dimensional, makes everything massively easier
            arraysize *= this.ParseInteger();
            this.CheckSize(arraysize, this.curToken.value, "array size", 1, 4096);
            this.Expect(']');
        } while (this.Accept('['));

        let array_type = new ArrayType(member_type, arraysize);
        return array_type;
    }
};
