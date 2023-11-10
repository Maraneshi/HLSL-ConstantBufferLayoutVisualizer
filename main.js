
const scalar_typenames = [
    "float16_t", "float32_t", "float64_t",
    "int8_t", "uint8_t", "int16_t", "uint16_t", "int32_t", "uint32_t", "int64_t", "uint64_t",
    "float", "int", "uint", "double", "bool", // NOTE: put these at the bottom since the previous ones have these as prefixes
];
const typenames_unsupported = [
    "min12int", "min16int", "min16uint", "min10float", "min16float", "half"
];
const keywords = [
    "cbuffer", "struct"
];
const keywords_unsupported = [ // TODO: support these keywords
    "typedef", "define", "column_major", "row_major", "packoffset"
];

const TokenType = {
    Identifier: "identifier", // NOTE: currently not differentiating between numbers and identifiers
    CBuffer: "cbuffer", // NOTE: these must exactly match the keywords, at least on the right side
    Struct: "struct",
    Typedef: "typedef",
    Define: "define",
    Column_Major: "column_major",
    Row_Major: "row_major",
    PackOffset: "packoffset",
    '(': ')',
    '(': ')',
    '{': '{',
    '}': '}',
    '[': '[',
    ']': ']',
    '<': '<',
    '>': '>',
    ',': ',',
    ';': ';',
    '#': '#'
};

class HLSLError {
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

class Token {
    constructor(type, value, line, column) {
        this.type = type;
        this.value = value;
        this.line = line;
        this.column = column;
    }
};

class Lexer {
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

            let char = this.GetNext();

            if (['(', ')', '{', '}', '[', ']', '<', '>', ',', ';', '#'].indexOf(char) != -1) {
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
                let identifier = "";
                let start_column = this.column;
                if (/\a|\w/.test(char)) {
                    do {
                        identifier += char;
                        char = this.PeekNext();
                    } while (/\a|\w/.test(char) && this.Consume()); // aaaaaaaaaaaaaaaaa
                }
                if (identifier != "") {
                    if (keywords.indexOf(identifier) != -1 || keywords_unsupported.indexOf(identifier) != -1)
                        tokens.push(this.MakeToken(identifier, identifier, start_column));
                    else
                        tokens.push(this.MakeToken(TokenType.Identifier, identifier, start_column));
                }
                else {
                    throw new HLSLError(`invalid or unexpected token ${char}`, this.line, start_column);
                }
            }
        }
        return tokens;
    }
};

class MemberVariable {
    constructor(type, name) {
        this.type = type;
        this.name = name;
        this.isCBuffer = false;
    }
};

// TODO: should we move to tagged union style for types instead? or interfaces?
class StructType {
    constructor(name, members) {
        this.name = name;
        this.members = members;
    }
};

class ArrayType {
    constructor(elementType, arraySize) {
        this.elementType = elementType;
        this.arraySize = arraySize;
        this.name = `${elementType.name}[${arraySize}]`;
    }
};
class BuiltinType {
    constructor(name, elementsize, alignment, vectorsize) {
        this.name = name;
        this.elementsize = elementsize;
        this.alignment = alignment;
        this.vectorsize = (vectorsize == undefined) ? 1 : vectorsize;
    }
    static Create(type, vectorsize) {
        let t = types_builtin[type];
        return new BuiltinType(vectorsize == 1 ? t.name : t.name + vectorsize, t.elementsize, t.alignment, vectorsize);
    }
};

const types_builtin = {
    "float"     : new BuiltinType("float"    , 4, 4),
    "float16_t" : new BuiltinType("float16_t", 2, 2),
    "float32_t" : new BuiltinType("float32_t", 4, 4),
    "float64_t" : new BuiltinType("float64_t", 8, 8),
    "int8_t"    : new BuiltinType("int8_t"   , 1, 1),
    "uint8_t"   : new BuiltinType("uint8_t"  , 1, 1),
    "int16_t"   : new BuiltinType("int16_t"  , 2, 2),
    "uint16_t"  : new BuiltinType("uint16_t" , 2, 2),
    "int32_t"   : new BuiltinType("int32_t"  , 4, 4),
    "uint32_t"  : new BuiltinType("uint32_t" , 4, 4),
    "int64_t"   : new BuiltinType("int64_t"  , 8, 8),
    "uint64_t"  : new BuiltinType("uint64_t" , 8, 8),
    "float"     : new BuiltinType("float"    , 4, 4),
    "int"       : new BuiltinType("int"      , 4, 4),
    "uint"      : new BuiltinType("uint"     , 4, 4),
    "double"    : new BuiltinType("double"   , 8, 8),
    "bool"      : new BuiltinType("bool"     , 4, 4),
};

class Parser {
    constructor(lexer) {
        this.index = -1;
        this.tokens = lexer.GetAllTokens();
        this.curToken = null;
        this.nextToken = this.tokens[this.index + 1] ?? null;
        this.cbuffers = [];
        this.structs = [];
        this.counter = 0;
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
    TokensLeft() {
        let ret = this.tokens.length - this.index - 1;
        return ret;
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
        let lastToken_str = lastToken ? ` after '${lastToken.value}' (${lastToken.line})` : "";
        let token_str = (token.type == TokenType.Identifier) ? `${token.type} '${token.value}'` : `${token.type}`;
        error += `${lastToken_str} but got ${token_str}`;
        throw HLSLError.CreateFromToken(error, token);
    }

    Expect(type) {
        let lastToken = this.curToken;
        let token = this.GetNext();

        if (keywords_unsupported.indexOf(token.value) != -1)
            throw HLSLError.CreateFromToken(`unsupported keyword '${token.value}'`, token);
        else if (token.type == '#')
            throw HLSLError.CreateFromToken(`unsupported token '#'`, token);

        if (token.type != type) {
            let lastToken_str = lastToken ? ` after '${lastToken.value}' (${lastToken.line})` : "";
            if (token.type == TokenType.Identifier)
                throw HLSLError.CreateFromToken(`expected ${type}${lastToken_str} but got ${token.type} '${token.value}'`, token);
            else
                throw HLSLError.CreateFromToken(`expected ${type}${lastToken_str} but got ${token.type}`, token);
        }
        return token;
    }
    Accept(type) {
        let token = this.PeekNext();

        if (keywords_unsupported.indexOf(token.value) != -1)
            throw HLSLError.CreateFromToken(`unsupported keyword '${token.value}'`, token);
        else if (token.type == '#')
            throw HLSLError.CreateFromToken(`unsupported token '#'`, token);

        if (token.type != type)
            return null;
        return this.Consume();
    }
    MakeAnonymousName() {
        return "_anon" + this.counter++;
    }
    ParseInteger() { // NOTE: currently not differentiating between numbers and identifiers
        let str = this.Expect(TokenType.Identifier).value;
        if (String(Number(str)) != str)
            throw HLSLError.CreateFromToken(`invalid integer ${str}`, this.curToken);
        return Number(str);
    }
    CheckSize(size, sizestr, name, min = 1, max = 4) {
        if (size < min || size > max)
            throw HLSLError.CreateFromToken(`invalid ${name} '${sizestr}' (must be between ${min} and ${max})`, this.curToken);
    }
    ParseFile() {
        while (this.TokensLeft() > 0) {
            let type_token = this.ExpectAny(TokenType.Struct, TokenType.CBuffer);
            let type_declaration = this.ParseStructTypeDeclaration();

            let variable_name_token = this.Accept(TokenType.Identifier);
            this.Expect(';');
            // treat top level declarations as "member variables" of the global scope so we can get their variable names
            let global_member = new MemberVariable(type_declaration, variable_name_token ? variable_name_token.value : "");
            if (type_token.type == TokenType.CBuffer) {
                global_member.isCBuffer = true;
                this.cbuffers.push(global_member);
            }
            else
                this.structs.push(global_member);
        }
    }
    ParseStructTypeDeclaration() {
        let type_name = this.Accept(TokenType.Identifier)?.value; // TODO: need to require this for top level declarations

        this.Expect('{');
        let members = [];
        while (!this.Accept('}')) {
            let member_type = this.ParseMemberType();
            if (!member_type)
                throw HLSLError.CreateFromToken(`cannot find type named '${this.curToken.value}'`, this.curToken);

            let member_name = this.Expect(TokenType.Identifier).value;

            if (this.Accept('[')) {
                member_type = this.ParseArrayType(member_type);
            }

            members.push(new MemberVariable(member_type, member_name));

            while (this.Accept(',')) {
                let additional_name = this.Expect(TokenType.Identifier).value;
                members.push(new MemberVariable(member_type, additional_name));
            }
            this.Expect(';');
        }
        return new StructType(type_name ?? this.MakeAnonymousName(), members);
    }
    ParseMemberType() {
        if (this.Accept(TokenType.Struct)) // inner structs
            return this.ParseStructTypeDeclaration();
        else
            return this.ParseTypeName(this.Expect(TokenType.Identifier).value);
    }
    ParseTypeName(name) {
        if (name == "matrix" || name == "vector") {
            return this.ParseTemplateType(name);
        }
        for (let t of scalar_typenames) {
            if (name.startsWith(t)) {
                if (name == t) {
                    return BuiltinType.Create(t, 1);
                }
                let suffix = name.substring(t.length);
                if (suffix.length == 1 || (suffix.length == 3 && suffix[1] == 'x')) {
                    let is_matrix = (suffix.length == 3);
                    let vectorsize = Number(suffix[0]);
                    this.CheckSize(vectorsize, suffix[0], is_matrix ? "matrix row size" : "vector size");
                    let vector_type = BuiltinType.Create(t, vectorsize);
                    if (is_matrix) {
                        let arraysize = Number(suffix[2]);
                        this.CheckSize(arraysize, suffix[2], "matrix column size");
                        return new ArrayType(vector_type, arraysize);
                    }
                    return vector_type;
                }
            }
        }
        return this.structs.find((element) => element.type.name == name)?.type;
    }
    ParseTemplateType(name) {
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
        let vector_type = BuiltinType.Create(scalar_type, vectorsize);
        if (is_matrix)
            return new ArrayType(vector_type, arraysize);
        else
            return vector_type;
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

class CBufferLayoutMember extends MemberVariable {
    constructor(type, name, offset, size = 0) {
        super(type, name);
        this.offset = offset;
        this.submembers = [];
        this.size = size;
        this.totalSubmemberCount = 0;
        this.isCBuffer = false;
        this.padding = 0;
    }
    PushSubmember(m) {
        if (this.submembers.length > 0) {
            let last = this.submembers[this.submembers.length - 1];
            let padding = m.offset - (last.offset + last.size);
            last.padding = padding;
            // NOTE: propagate padding back into last array member, makes it easier to access later
            if (last.type instanceof ArrayType) {
                last.submembers[last.submembers.length - 1].padding = padding;
            }
        }
        this.submembers.push(m);
        if (m.type instanceof ArrayType)
            this.totalSubmemberCount += m.totalSubmemberCount;
        else if (m.type instanceof StructType)
            this.totalSubmemberCount += m.totalSubmemberCount + 1;
        else
            this.totalSubmemberCount++;
    }
}
class CBufferLayoutAlgorithm {
    constructor(cbuffers) {
        this.cbuffers = cbuffers;
        this.out_cbuffer_layouts = [];
        this.curOffset = 0;
    }
    AlignTo16Bytes() {
        return this.curOffset = (this.curOffset + 15) & ~15;
    }
    AlignTo(align) {
        return this.curOffset = (this.curOffset + (align-1)) & ~(align-1);
    }
    LayoutMemberType(type, name, parent) {
        // TODO: triple check edge cases
        if (type instanceof BuiltinType) {
            this.AlignTo(type.alignment); // base type alignment
            let size = type.elementsize * type.vectorsize;
            if (Math.trunc((this.curOffset + size - 1) / 16) > Math.trunc(this.curOffset / 16)) // if we cross a 16 byte boundary, align
                this.AlignTo16Bytes();
            parent.PushSubmember(new CBufferLayoutMember(type, name, this.curOffset, size));
            this.curOffset += size;
        }
        else if (type instanceof ArrayType) {
            this.AlignTo16Bytes();
            let startOffset = this.curOffset;
            let array = new CBufferLayoutMember(type, name, this.curOffset);
            for (let i = 0; i < type.arraySize; i++) {
                this.AlignTo16Bytes();
                this.LayoutMemberType(type.elementType, name + '[' + String(i) + ']', array);
            }
            array.size = this.curOffset - startOffset;
            parent.PushSubmember(array);
        }
        else if (type instanceof StructType) {
            let struct = this.LayoutStructType(type, name, parent);
            parent.PushSubmember(struct);
        }
    }
    LayoutStructType(type, name, parent = null) {
        this.AlignTo16Bytes();
        let startOffset = this.curOffset;
        let layout = new CBufferLayoutMember(type, name, this.curOffset);
        for (let member of type.members) {
            this.LayoutMemberType(member.type, member.name, layout);
        }
        layout.size = this.curOffset - startOffset;
        return layout;
    }
    GenerateLayout() {
        for (let buffer of this.cbuffers) {
            let layout = this.LayoutStructType(buffer.type, buffer.name);
            this.out_cbuffer_layouts.push(layout);
            layout.isCBuffer = true;
        }
        return this.out_cbuffer_layouts;
    }
};

class ColorArray {
    constructor(size, shuffle, shuffle_subdivisions) {
        this.shuffle = shuffle;
        this.shuffle_subdivisions = shuffle_subdivisions;
        this.colors = this.#interpolateColors(size);
    }
    OklabCHToString(l, c, h) {
        return `oklch(${l} ${c * 100}% ${h})`;
    }
    GetRainbowColor(t) {
        let l = color_lightness.valueAsNumber;
        let c = color_saturation.valueAsNumber;
        let h = 360 * t - 70;
        return this.OklabCHToString(l, c, h);
    }
    /* Must use an interpolated color scale, which has a range of [0, 1] */
    #interpolateColors(dataLength)
    {
        let colorArray = []
        for (let i = 0; i < dataLength; i++) {
            let colorPoint = i / dataLength;
            colorArray.push(this.GetRainbowColor(colorPoint));
        }

        // divide evenly into multiple ranges and zip them, in perhaps the most complicated way possible
        if (this.shuffle) {
            let subranges = [];
            let largest_subrange_size = 0;
            let count = 0;
            let running_sum_frac = 0;
            for (let subdiv = 0; subdiv < this.shuffle_subdivisions; subdiv++) {
                subranges.push([]);
                let subdiv_size_full = dataLength / this.shuffle_subdivisions;
                let subdiv_size_floor = Math.floor(subdiv_size_full);
                let subdiv_size_frac = subdiv_size_full - subdiv_size_floor;
                running_sum_frac += subdiv_size_frac;
                let this_subrange_size = subdiv_size_floor;
                if (running_sum_frac > 0.999) {
                    this_subrange_size += 1;
                    running_sum_frac -= 1;
                }
                if (largest_subrange_size < this_subrange_size)
                    largest_subrange_size = this_subrange_size;

                for (let i = 0; i < this_subrange_size; i++) {
                    subranges[subdiv].push(colorArray[count]);
                    count++;
                }
            }

            colorArray = [];
            for (let i = 0; i < largest_subrange_size; i++) {
                for (let j = 0; j < this.shuffle_subdivisions; j++) {
                    if (i < subranges[j].length)
                        colorArray.push(subranges[j][i]);
                }
            }
        }
        return colorArray;
    }
    Get(i) {
        return this.colors[i];
    }
};


function LayoutCountMembers(m, expanded_arrays) {
    let member_count = 0;
    if (m.type instanceof StructType)
        member_count += LayoutCountStructMembers(m, expanded_arrays);
    else if (m.type instanceof ArrayType)
        member_count += LayoutCountArrayMembers(m, expanded_arrays);
    else
        member_count++;
    return member_count;
}
function LayoutCountArrayMembers(array, expanded_arrays) {
    let member_count = 0;
    if (expanded_arrays) {
        for (let m of array.submembers)
            member_count += LayoutCountMembers(m, expanded_arrays);
    }
    else {
        member_count += LayoutCountMembers(array.submembers[0], expanded_arrays);
    }
    return member_count;
}
function LayoutCountStructMembers(struct, expanded_arrays) {
    let member_count = 1;
    for (let m of struct.submembers) {
        member_count += LayoutCountMembers(m, expanded_arrays);
    }
    return member_count;
}

function CreateColoredText(text, color) {
    const span = document.createElement("span");
    span.setAttribute("style", `color:${color}`);
    span.append(text);
    return span;
}

class StructPrinter {
    constructor(text_node, expanded_arrays, alignment, shuffle, shuffle_subdivisions) {
        this.text_node = text_node;
        this.expanded_arrays = expanded_arrays;
        this.alignment = alignment;
        this.shuffle = shuffle;
        this.shuffle_subdivisions = shuffle_subdivisions;
        this.Reset();
    }
    Reset() {
        this.indentation = 0;
        this.color_index = 0;
        this.check_size = 0;
    }
    NextColor() {
        return this.colors.Get(this.color_index++);
    }
    GetIndentationString() {
        return "    ".repeat(this.indentation);
    }
    AddText(str, color) {
        this.text_node.appendChild(CreateColoredText(this.GetIndentationString() + str, color));
    }
    AddAlignedText(prefix, suffix, color) {
        prefix = this.GetIndentationString() + prefix;
        suffix = " ".repeat(Math.max(this.alignment - prefix.length, 1)) + suffix;
        this.text_node.appendChild(CreateColoredText(prefix + suffix, color));
    }
    GetOffsetString(offset) {
        return `${String(offset).padStart(6)}`;
    }
    GetSizeString(size) {
        return `${String(size).padStart(4)}`;
    }
    GetPaddingString(padding) {
        return `${padding > 0 ? "+" + String(padding).padStart(2) : ""}`;
    }
    GetOffSizePadString(offset, size, padding) {
        return `${this.GetOffsetString(offset)} ${this.GetSizeString(size)} ${this.GetPaddingString(padding)}`;
    }
    PrintColoredStructLayout(struct) {
        this.Reset();
        this.text_node.replaceChildren();
        let member_count = LayoutCountStructMembers(struct, this.expanded_arrays);
        this.colors = new ColorArray(member_count, this.shuffle, this.shuffle_subdivisions);
        this.AddAlignedText("", `${this.GetOffsetString("offset")} ${this.GetSizeString("size")} +pad\n`);
        this.text_node.children[this.text_node.children.length - 1].setAttribute("style", "font-weight: bold;");
        this.PrintColoredStructLayoutInternal(struct, null);
        //this.AddAlignedText("size check", `${this.GetOffsetString("")} ${this.GetSizeString(this.check_size)}\n`);
    }
    PrintColoredStructLayoutInternal(struct, parent) {
        let struct_color = this.NextColor();
        this.AddText(`${struct.isCBuffer ? "cbuffer" : "struct"} ${struct.type.name} {\n`, struct_color);
        this.indentation++;
        for (let m of struct.submembers) {
            this.PrintColoredLayoutMember(m, struct);
        }
        this.indentation--;
        if (struct.name != "") {
            if (!this.expanded_arrays && parent && parent.type instanceof ArrayType) {
                this.AddAlignedText(`} ${parent.name}[${parent.submembers.length}];`, `${this.GetOffSizePadString(parent.offset, parent.size, parent.padding)}\n`, struct_color);
            }
            else {
                this.AddAlignedText(`} ${struct.name};`, `${this.GetOffSizePadString(struct.isCBuffer ? "" : struct.offset, struct.size, struct.padding)}\n`, struct_color);
                this.check_size += struct.padding;
            }
        }
        else {
            this.AddAlignedText("};", `${this.GetOffSizePadString("", struct.size, struct.padding)}\n`, struct_color);
        }
    }
    PrintColoredLayoutMember(member, parent) {
        if (member.type instanceof StructType) {
            this.PrintColoredStructLayoutInternal(member, parent);
        }
        else if (member.type instanceof ArrayType) {
            if (this.expanded_arrays) {
                for (let m of member.submembers)
                    this.PrintColoredLayoutMember(m, member);
            }
            else {
                this.PrintColoredLayoutMember(member.submembers[0], member);
                if (member.submembers[0].type instanceof StructType)
                    this.check_size -= member.submembers[0].size;
                for (let m of member.submembers) {
                    this.check_size += m.size + m.padding;
                }
            }
        }
        else {
            if (!this.expanded_arrays && parent && parent.type instanceof ArrayType) {
                this.AddAlignedText(`${member.type.name} ${parent.name}[${parent.submembers.length}];`, `${this.GetOffSizePadString(parent.offset, parent.size, parent.padding)}\n`, this.NextColor());
            }
            else {
                this.AddAlignedText(`${member.type.name} ${member.name};`, `${this.GetOffSizePadString(member.offset, member.size, member.padding)}\n`, this.NextColor());
                this.check_size += member.size + member.padding;
            }
        }
    }
}

class StructLayoutVisualizer {
    constructor(svg_node, expanded_arrays, shuffle, shuffle_subdivisions) {
        this.svg_node = svg_node;
        this.expanded_arrays = expanded_arrays;
        this.shuffle = shuffle;
        this.shuffle_subdivisions = shuffle_subdivisions;
        this.color_index = 0;
        this.width_per_byte = 24;
        this.outer_rect_height = 36;
        this.height_per_vector = this.outer_rect_height + 24;
        this.stroke_width = 2;
        this.init_offset_y = 20;
        this.init_offset_x = 16;
        this.level = 0;
    }
    NextColor() {
        return this.colors.Get(this.color_index++);
    }
    AddRectOuter(start_offset) {
        let x = Math.floor(start_offset % 16) * this.width_per_byte    + this.init_offset_x;
        let y = Math.floor(start_offset / 16) * this.height_per_vector + this.init_offset_y;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("stroke", "#888888");
        rect.setAttribute("stroke-width", this.stroke_width);
        rect.setAttribute("fill", "none");
        rect.setAttribute("width", 16 * this.width_per_byte);
        rect.setAttribute("height", this.outer_rect_height);
        rect.setAttribute("y", y);
        rect.setAttribute("x", x);
        this.svg_node.append(rect);
        for (let i = 0; i <= 16; i += 4) {
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            if (dark_theme.checked)
                text.setAttribute("fill", "#D4D4D4");
            text.setAttribute("x", this.init_offset_x + i * this.width_per_byte);
            text.setAttribute("y", y - 5);
            text.setAttribute("text-anchor", "middle");
            text.append(String(start_offset + i));
            this.svg_node.append(text);
            if ((i % 16) != 0) {
                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                if (dark_theme.checked) {
                    line.setAttribute("stroke", "#D4D4D4");
                    line.setAttribute("opacity", 0.325);
                }
                else {
                    line.setAttribute("stroke", "#777777");
                    line.setAttribute("opacity", 0.25);
                }
                line.setAttribute("stroke-width", this.stroke_width / 2);
                line.setAttribute("x1", this.init_offset_x + i * this.width_per_byte);
                line.setAttribute("x2", this.init_offset_x + i * this.width_per_byte);
                line.setAttribute("y1", y);
                line.setAttribute("y2", y + this.outer_rect_height);
                this.svg_node.append(line);
            }
        }
    }
    AddRectInner(color, start_offset, size_in_bytes, name, level = this.level) {
        let x_offset = Math.floor(start_offset % 16) * this.width_per_byte    + this.init_offset_x;
        let y_offset = Math.floor(start_offset / 16) * this.height_per_vector + this.init_offset_y;
        let pad = (this.stroke_width + 1) * level;
        let x = x_offset + pad;
        let y = y_offset + pad;
        let width = size_in_bytes * this.width_per_byte - pad*2;
        let height = this.outer_rect_height - pad*2;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        if (this.level == 0)
            rect.setAttribute("opacity", 0.70);
        rect.setAttribute("stroke", color);
        rect.setAttribute("stroke-width", this.stroke_width);
        rect.setAttribute("fill", "none");
        rect.setAttribute("width", width);
        rect.setAttribute("height", height);
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        this.svg_node.append(rect);
        if (name) {
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            if (dark_theme.checked)
                text.setAttribute("fill", "#D4D4D4");
            text.setAttribute("x", x + width / 2);
            text.setAttribute("y", y + height / 2);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("dominant-baseline", "middle");
            text.setAttribute("font-weight", "bold");
            text.append(name);
            this.svg_node.append(text);
        }
    }
    VisualizeMember(member, parent) {
        if (member.type instanceof StructType) {
            this.#VisualizeStruct(member, parent);
        }
        else if (member.type instanceof ArrayType) {
            if (this.expanded_arrays) {
                for (let m of member.submembers)
                    this.VisualizeMember(m, member);
            }
            else {
                let array_color = this.NextColor();
                for (let i = 0; i < Math.ceil(member.size / 16); i++) {
                    this.AddRectInner(array_color, member.offset + i * 16, Math.min(member.size - i * 16, 16), member.name);
                }
                if (member.submembers[0].type instanceof StructType) {
                    this.#VisualizeStruct(member.submembers[0], member);
                }
            }
        }
        else {
            for (let i = 0; i < Math.ceil(member.size / 16); i++) {
                this.AddRectInner(this.NextColor(), member.offset + i * 16, Math.min(member.size - i * 16, 16), member.name);
            }
        }
    }
    #VisualizeStruct(struct, parent) {
        if (this.expanded_arrays || !parent || !(parent.type instanceof ArrayType)) {
            let struct_color = this.NextColor();
            for (let i = 0; i < Math.ceil(struct.size / 16); i++) {
                this.AddRectInner(struct_color, struct.offset + i * 16, Math.min(struct.size - i * 16, 16));
            }
        }

        this.level++;
        for (let m of struct.submembers) {
            this.VisualizeMember(m, struct);
        }
        this.level--;
    }

    VisualizeLayout(layout) {
        this.svg_node.replaceChildren();
        let member_count = LayoutCountStructMembers(layout, this.expanded_arrays);
        this.colors = new ColorArray(member_count, this.shuffle, this.shuffle_subdivisions);
        this.svg_node.setAttribute("width", 16 * this.width_per_byte + this.init_offset_x * 4);
        this.svg_node.setAttribute("height", Math.ceil(layout.size / 16) * this.height_per_vector + this.init_offset_y);
        for (let i = 0; i < Math.ceil(layout.size / 16); i++) {
            this.AddRectOuter(i * 16);
        }
        this.#VisualizeStruct(layout, null);
    }
};

const out_text = document.getElementById("output_text");
const out_svg = document.getElementById("output_svg");

const editor = monaco.editor.create(document.getElementById('editor_container'), {
    value: `struct Test {
    float a, b;
};

cbuffer example {
    Test test[2];
    float Val1;
    float2 Val2[3][2];
    float Val3;
    struct { float c; } s;
    double d;
    float3x4 mat;
    float f;
    matrix<int,1,2> mat2;
    vector<double,1> dv;
    uint16_t u;
};`,
    language: 'cpp',
    minimap: { enabled: false },
    automaticLayout: true,
    theme:'vs-dark'
});

let parse_timer;
editor.getModel().onDidChangeContent(() => {
    if (auto_parse_delay.value != auto_parse_delay.getAttribute("max")) {
        clearTimeout(parse_timer);
        parse_timer = setTimeout(ParseHLSL, auto_parse_delay.value);
    }
});

const light_theme_sheet = new CSSStyleSheet();

let monaco_style = getComputedStyle(document.querySelector('.monaco-editor'));
let monaco_style_fg = monaco_style.getPropertyValue('--vscode-editor-foreground');
let monaco_style_bg = monaco_style.getPropertyValue('--vscode-editor-background');
let monaco_style_button_fg = monaco_style.getPropertyValue('--vscode-button-foreground');
let monaco_style_button_bg = monaco_style.getPropertyValue('--vscode-button-background');
let monaco_style_input_fg = monaco_style.getPropertyValue('--vscode-input-foreground');
let monaco_style_input_bg = monaco_style.getPropertyValue('--vscode-input-background');
const dark_theme_sheet = new CSSStyleSheet();
dark_theme_sheet.replaceSync(
    `:root {
        color: ${monaco_style_fg};
        background-color: ${monaco_style_bg};
    }
    text {
        color: ${monaco_style_fg};
        background-color: ${monaco_style_bg};
    }
    span {
        color: ${monaco_style_fg};
        background-color: ${monaco_style_bg};
    }
    input {
        color: ${monaco_style_input_fg};
        background-color: ${monaco_style_input_bg};
    }
    button {
        color: ${monaco_style_button_fg};
        background-color: ${monaco_style_button_bg};
    }`);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, dark_theme_sheet];

function ApplyLightTheme() {
    dark_theme_sheet.disabled = true;
    monaco.editor.setTheme('vs');
    color_lightness.value = 0.72;
    color_lightness_value.value = 0.72;
    color_saturation.value = 1.0;
    color_saturation_value.value = 1.0;
}

function ApplyDarkTheme() {
    dark_theme_sheet.disabled = false;
    monaco.editor.setTheme('vs-dark');
    color_lightness.value = 0.60;
    color_lightness_value.value = 0.60;
    color_saturation.value = 0.60;
    color_saturation_value.value = 0.60;
}
function ToggleTheme() {
    if (dark_theme.checked)
        ApplyDarkTheme();
    else
        ApplyLightTheme();
}
function ParseHLSL() {

    out_text.replaceChildren();
    monaco.editor.setModelMarkers(editor.getModel(), "owner", []);

    try {
        let lexer = new Lexer(editor.getValue());
        let parser = new Parser(lexer);

        //for (let i = 0; i < parser.tokens.length; i++)
        //    out_text.append(CreateColoredText(parser.tokens[i].value + "\t" + parser.tokens[i].line + '\n'));

        parser.ParseFile();

        let layouts = new CBufferLayoutAlgorithm(parser.cbuffers).GenerateLayout();

        let printer = new StructPrinter(out_text, expanded_arrays.checked, text_alignment.value, color_shuffle.checked, color_shuffle_subdivisions.value);
        printer.PrintColoredStructLayout(layouts[0]);
        let viz = new StructLayoutVisualizer(out_svg, expanded_arrays.checked, color_shuffle.checked, color_shuffle_subdivisions.value);
        viz.VisualizeLayout(layouts[0]);
    }
    catch (error) {
        var markers = [{
            severity: monaco.MarkerSeverity.error,
            message: error.message,
            startLineNumber: error.line,
            startColumn: error.start_column,
            endLineNumber: error.line,
            endColumn: error.end_column
        }];
        monaco.editor.setModelMarkers(editor.getModel(), "owner", markers);

        out_text.append(`ERROR(${error.line}:${error.start_column}): ${error.message}`);
    }
}

function EnableResizer(id) {
    // Query the element
    const resizer = document.getElementById(id);
    const leftSide = resizer.previousElementSibling;
    const rightSide = resizer.nextElementSibling;

    // The current position of mouse
    let x = 0;
    let y = 0;
    let leftWidth = 0;

    // Handle the mousedown event
    // that's triggered when user drags the resizer
    const mouseDownHandler = function (e) {
        // Get the current mouse position
        x = e.clientX;
        y = e.clientY;
        leftWidth = leftSide.getBoundingClientRect().width;

        // Attach the listeners to document
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    };

    const mouseMoveHandler = function (e) {
        // How far the mouse has been moved
        const dx = e.clientX - x;
        const dy = e.clientY - y;

        const newLeftWidth = ((leftWidth + dx) * 100) / resizer.parentNode.getBoundingClientRect().width;
        leftSide.style.width = newLeftWidth + '%';

        resizer.style.cursor = 'col-resize';
        document.body.style.cursor = 'col-resize';

        leftSide.style.userSelect = 'none';
        leftSide.style.pointerEvents = 'none';

        rightSide.style.userSelect = 'none';
        rightSide.style.pointerEvents = 'none';
    };

    const mouseUpHandler = function () {
        resizer.style.removeProperty('cursor');
        document.body.style.removeProperty('cursor');

        leftSide.style.removeProperty('user-select');
        leftSide.style.removeProperty('pointer-events');

        rightSide.style.removeProperty('user-select');
        rightSide.style.removeProperty('pointer-events');

        // Remove the handlers of mousemove and mouseup
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
    };

    // Attach the handler
    resizer.addEventListener('mousedown', mouseDownHandler);
}

EnableResizer("dragMe");
