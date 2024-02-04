import { StructType, ArrayType, Parser, Lexer, HLSLError } from './cbuffer_parser.js';
import { CBufferLayoutAlgorithm, StructuredBufferLayoutAlgorithm } from './cbuffer_layout.js';

function DotProduct(v1, v2) {
    return v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
}

function Mat3x3MulVec3(mat, vec) {
    let res = [0, 0, 0];
    res[0] = DotProduct(mat[0], vec);
    res[1] = DotProduct(mat[1], vec);
    res[2] = DotProduct(mat[2], vec);
    return res;
}

////////////////////////////////////////////////
// OkLCH to sRGB color conversion, slightly modified from:
// CSS Color Module Level 4 spec https://www.w3.org/TR/css-color-4/#color-conversion-code Copyright © 2022 World Wide Web Consortium. https://www.w3.org/copyright/software-license-2023/

function gam_sRGB(RGB) {
    // convert an array of linear-light sRGB values in the range 0.0-1.0
    // to gamma corrected form
    // https://en.wikipedia.org/wiki/SRGB
    // Extended transfer function:
    // For negative values, linear portion extends on reflection
    // of axis, then uses reflected pow below that
    return RGB.map(function (val) {
        let sign = val < 0 ? -1 : 1;
        let abs = Math.abs(val);

        if (abs > 0.0031308) {
            return sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
        }

        return 12.92 * val;
    });
}

function XYZ_to_lin_sRGB(XYZ) {
    // convert XYZ to linear-light sRGB

    var M = [
        [12831 / 3959, -329 / 214, -1974 / 3959],
        [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
        [705 / 12673, -2585 / 12673, 705 / 667],
    ];

    return Mat3x3MulVec3(M, XYZ);
}
function OKLab_to_XYZ(OKLab) {
    // Given OKLab, convert to XYZ relative to D65
    var LMStoXYZ = [
        [1.2268798733741557, -0.5578149965554813, 0.28139105017721583],
        [-0.04057576262431372, 1.1122868293970594, -0.07171106666151701],
        [-0.07637294974672142, -0.4214933239627914, 1.5869240244272418]
    ];
    var OKLabtoLMS = [
        [0.99999999845051981432, 0.39633779217376785678, 0.21580375806075880339],
        [1.0000000088817607767, -0.1055613423236563494, -0.063854174771705903402],
        [1.0000000546724109177, -0.089484182094965759684, -1.2914855378640917399]
    ];

    var LMSnl = Mat3x3MulVec3(OKLabtoLMS, OKLab);
    return Mat3x3MulVec3(LMStoXYZ, LMSnl.map(c => c ** 3));
}

function OKLCH_to_OKLab(OKLCH) {
    return [
        OKLCH[0], // L is still L
        OKLCH[1] * Math.cos(OKLCH[2] * Math.PI / 180), // a
        OKLCH[1] * Math.sin(OKLCH[2] * Math.PI / 180)  // b
    ];
}
////////////////////////////////////////////////

class ColorArray {
    constructor(size, options) {
        this.shuffle = options.color_shuffle;
        this.shuffle_subdivisions = options.color_shuffle_subdivisions;
        this.lightness = options.color_lightness;
        this.saturation = options.color_saturation;
        this.hue_start = options.color_hue_start;
        this.hue_range = options.color_hue_range;
        this.colors = this.GetColorArray(size);
    }
    GetRainbowColor(t) {
        let l = this.lightness;
        let c = this.saturation; // NOTE: our "saturation" value is a percentage, chroma max value is defined to be 0.4
        let h = this.hue_range * t + this.hue_start;
        //return `oklch(${l} ${c * 100}% ${h})`;
        // convert to RGB for old browsers (e.g. Chrome on Win7, old iPhones/Macs)
        let oklch = [l, c * 0.4, h];
        let okl = OKLCH_to_OKLab(oklch);
        let xyz = OKLab_to_XYZ(okl);
        let rgb = XYZ_to_lin_sRGB(xyz);
        rgb[0] = Math.max(Math.min(rgb[0], 1.0), 0.0); // just for extra safety
        rgb[1] = Math.max(Math.min(rgb[1], 1.0), 0.0);
        rgb[2] = Math.max(Math.min(rgb[2], 1.0), 0.0);
        let srgb = gam_sRGB(rgb);
        return `rgb(${srgb[0] * 255}, ${srgb[1] * 255}, ${srgb[2] * 255})`
    }
    GetColorArray(dataLength) {
        let colorArray = [];
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
    if (color)
        span.setAttribute("style", `color:${color}`);
    span.append(text);
    return span;
}

class StructPrinter {
    constructor(text_node, colors, options) {
        this.text_node = text_node;
        this.expanded_arrays = options.expanded_arrays;
        this.alignment_offset = options.text_alignment_offset;
        this.alignment_min = options.text_alignment_min;
        this.indent_width = options.text_indent_width;
        this.colors = colors;
        this.indentation = 0;
        this.color_index = 0;
        this.check_size = 0;
    }
    NextColor() {
        return this.color_index++;
    }
    GetIndentationString() {
        return " ".repeat(this.indent_width * this.indentation);
    }
    AddText(member, str, color_index) {
        let text = CreateColoredText(this.GetIndentationString() + str, this.colors.Get(color_index));
        text.CBV_color_index = color_index;
        this.text_node.appendChild(text);
        member?.CBV_texts.push(text);
    }
    AddAlignedText(member, prefix, suffix, color_index) {
        prefix = this.GetIndentationString() + prefix;
        let text = CreateColoredText(prefix, this.colors.Get(color_index));
        // save aligned suffix for later
        text.CBV_suffix = suffix;
        text.CBV_color_index = color_index;
        this.text_node.appendChild(text);
        member?.CBV_texts.push(text);
    }
    AddAlignedTextHeader(header, extra_alignment) {
        let span = CreateColoredText("", undefined);
        span.setAttribute("style", "font-weight: bold;");
        // save aligned suffix for later
        span.CBV_suffix = header;
        span.CBV_extra_alignment = extra_alignment;
        this.text_node.appendChild(span);
    }
    GetOffsetString(offset) {
        return `${String(offset).padStart(3)}`;
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
        this.text_node.replaceChildren();
        this.AddAlignedTextHeader(`offset size +pad\n`, -3 /* padding added to numeric offset minus length of "offset" */);
        struct.CBV_texts = [];
        this.PrintColoredStructLayoutInternal(struct, null);
        //this.AddAlignedText(null, "size check", `${this.GetOffsetString("")} ${this.GetSizeString(this.check_size)}\n`);

        // find longest line
        let max_len = 0;
        for (let child of this.text_node.children) {
            if (child.CBV_suffix)
                max_len = Math.max(max_len, child.textContent.length);
        }
        // add suffix aligned to longest line + offset
        for (let child of this.text_node.children) {
            if (child.CBV_suffix) {
                let len = max_len - child.textContent.length;
                let offset = this.alignment_offset + (child.CBV_extra_alignment ?? 0);
                let min = Math.max(this.alignment_min - child.textContent.length + (child.CBV_extra_alignment ?? 0), 0);
                child.append(" ".repeat(Math.max(len + offset, min)) + child.CBV_suffix);
            }
        }
    }
    PrintColoredStructLayoutInternal(struct, parent) {
        let struct_color = this.NextColor();

        if (struct.isSBuffer)
            this.AddText(struct, `StructuredBuffer {\n`, struct_color);
        else
            this.AddText(struct, `${struct.isCBuffer ? "cbuffer" : "struct"} ${struct.type.name} {\n`, struct_color);

        this.indentation++;
        for (let m of struct.submembers) {
            this.PrintColoredLayoutMember(m, struct);
        }
        this.indentation--;
        if (struct.name != "") {
            if (!this.expanded_arrays && parent && parent.type instanceof ArrayType) {
                this.AddAlignedText(parent, `} ${parent.name}[${parent.submembers.length}];`, `${this.GetOffSizePadString(parent.offset, parent.size, parent.padding)}\n`, struct_color);
            }
            else {
                this.AddAlignedText(struct, `} ${struct.name};`, struct.isSBuffer ? "" : `${this.GetOffSizePadString(struct.isGlobal ? "" : struct.offset, struct.size, struct.padding)}\n`, struct_color);
                this.check_size += struct.padding;
            }
        }
        else {
            this.AddAlignedText(struct, "};", `${this.GetOffSizePadString("", struct.size, struct.padding)}\n`, struct_color);
        }
    }
    PrintColoredLayoutMember(member, parent) {
        member.CBV_texts = [];
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
                this.AddAlignedText(parent, `${member.type.name} ${parent.name}[${parent.submembers.length}];`, `${this.GetOffSizePadString(parent.offset, parent.size, parent.padding)}\n`, this.NextColor());
            }
            else {
                this.AddAlignedText(member, `${member.type.name} ${member.name};`, `${this.GetOffSizePadString(member.offset, member.size, member.padding)}\n`, this.NextColor());
                this.check_size += member.size + member.padding;
            }
        }
    }
}

// TODO: can we do this with a CSS sheet and then dynamically adjust that one instead of manually going through each element? but these aren't CSS properties...
//       Apparently some or all of these can be set in CSS instead. We may be able to put "level" in a CSS variable too.

function ApplyThemeOuterRectText(text, dark_theme) {
    if (dark_theme)
        text.setAttribute("fill", "#D4D4D4");
    else
        text.setAttribute("fill", "black");
}
function ApplyThemeOuterRectLine(line, dark_theme) {
    if (dark_theme) {
        line.setAttribute("stroke", "#D4D4D4");
        line.setAttribute("opacity", 0.325);
    }
    else {
        line.setAttribute("stroke", "#777777");
        line.setAttribute("opacity", 0.25);
    }
}

function ApplyThemeInnerRect(rect, text, dark_theme, level) {
    if (dark_theme) {
        rect.setAttribute("fill", "black");
        rect.setAttribute("fill-opacity", 0.2 / (level + 1));
        text?.setAttribute("fill", "#D4D4D4");
    }
    else {
        rect.setAttribute("fill", "white");
        rect.setAttribute("fill-opacity", 0.2 / (level + 1));
        text?.setAttribute("fill", "black");
    }
}

class StructLayoutVisualizer {
    constructor(svg_node, text_node, colors, options) {
        this.text_node = text_node;
        this.svg_node = svg_node;
        this.expanded_arrays = options.expanded_arrays;
        this.colors = colors;
        this.dark_theme = options.dark_theme;
        this.color_index = 0;
        this.width_per_byte = options.svg_width_per_byte;
        this.outer_rect_height = options.svg_outer_rect_height;
        this.height_per_vector = this.outer_rect_height + 24;
        this.stroke_width = 2;
        this.init_offset_y = 20;
        this.init_offset_x = 14;
        this.level = 0;
        this.hex_offsets = options.svg_hex_offsets;
    }
    NextColor() {
        return this.color_index++;
    }
    CreateOuterRectGroup(layout) {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        for (let i = 0; i < Math.ceil(layout.size / 16); i++) {
            this.AddRectOuter(group, i * 16);
        }
        this.svg_node.append(group);
    }
    AddRectOuter(group, start_offset) {
        let x = Math.floor(start_offset % 16) * this.width_per_byte + this.init_offset_x;
        let y = Math.floor(start_offset / 16) * this.height_per_vector + this.init_offset_y;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("stroke", "#888888");
        rect.setAttribute("stroke-width", this.stroke_width);
        rect.setAttribute("fill", "none");
        rect.setAttribute("width", 16 * this.width_per_byte);
        rect.setAttribute("height", this.outer_rect_height);
        rect.setAttribute("y", y);
        rect.setAttribute("x", x);
        group.append(rect);
        for (let i = 0; i <= 16; i += 4) {
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            ApplyThemeOuterRectText(text, this.dark_theme);
            text.setAttribute("x", this.init_offset_x + i * this.width_per_byte);
            text.setAttribute("y", y - 5);
            text.setAttribute("text-anchor", "middle");
            let offset_str = this.hex_offsets ? Number(start_offset + i).toString(16).toUpperCase() : String(start_offset + i);
            text.append(offset_str);
            group.append(text);
            if ((i % 16) != 0) {
                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                ApplyThemeOuterRectLine(line, this.dark_theme);
                line.setAttribute("stroke-width", this.stroke_width / 2);
                line.setAttribute("x1", this.init_offset_x + i * this.width_per_byte);
                line.setAttribute("x2", this.init_offset_x + i * this.width_per_byte);
                line.setAttribute("y1", y);
                line.setAttribute("y2", y + this.outer_rect_height);
                group.append(line);
            }
        }
    }
    AddRectInner(color_index, start_offset, size_in_bytes, name, level = this.level) {
        let color = this.colors.Get(color_index);
        let x_offset = Math.floor(start_offset % 16) * this.width_per_byte + this.init_offset_x;
        let y_offset = Math.floor(start_offset / 16) * this.height_per_vector + this.init_offset_y;
        let pad = (this.stroke_width + 1) * level;
        let x = x_offset + pad;
        let y = y_offset + pad;
        let width = size_in_bytes * this.width_per_byte - pad * 2;
        let height = this.outer_rect_height - pad * 2;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        if (level == 0)
            rect.setAttribute("opacity", 0.70);
        rect.setAttribute("stroke", color);
        rect.setAttribute("stroke-width", this.stroke_width);
        rect.setAttribute("width", width);
        rect.setAttribute("height", height);
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.CBV_color_index = color_index;
        rect.CBV_level = level;
        this.svg_node.append(rect);
        let text = null;
        if (name) {
            text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", x + width / 2);
            text.setAttribute("y", y + height / 2);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("dominant-baseline", "middle");
            text.setAttribute("font-weight", "bold");
            text.append(name);
            this.svg_node.append(text);
        }
        ApplyThemeInnerRect(rect, text, this.dark_theme, level);
        return { rect: rect, text: text };
    }
    AddRectForMember(color_index, member, skip_name = false) {
        member.CBV_rects = [];

        let i = 0;
        while (i < member.size) {
            let member_row_start = ((member.offset + i) % 16);
            let member_row_end = Math.min(16, (member_row_start + member.size - i));
            let rect_size = member_row_end - member_row_start;
            let inner_rect = this.AddRectInner(color_index, member.offset + i, rect_size, skip_name ? null : member.name);
            member.CBV_rects.push(inner_rect);
            i += rect_size;
        }
    }
    VisualizeMember(member, parent) {
        if (member.type instanceof StructType) {
            this.#VisualizeStruct(member, parent);
        }
        else if (member.type instanceof ArrayType) {
            if (this.expanded_arrays) {
                member.CBV_rects = [];
                for (let m of member.submembers)
                    this.VisualizeMember(m, member);
            }
            else {
                this.AddRectForMember(this.NextColor(), member);

                if (member.submembers[0].type instanceof StructType) {
                    this.#VisualizeStruct(member.submembers[0], member);
                }
            }
        }
        else {
            this.AddRectForMember(this.NextColor(), member);
        }
    }
    #VisualizeStruct(struct, parent) {
        if (this.expanded_arrays || !parent || !(parent.type instanceof ArrayType)) {
            this.AddRectForMember(this.NextColor(), struct, true);
        }

        this.level++;
        for (let m of struct.submembers) {
            this.VisualizeMember(m, struct);
        }
        this.level--;
    }

    VisualizeLayout(layout) {
        this.svg_node.replaceChildren();

        // ensure we have a tight fit, the SVG is already very large
        if (layout.size < 100)
            this.init_offset_x = 10;
        else if (layout.size < 1000)
            this.init_offset_x = 14;
        else
            this.init_offset_x = 18;

        this.svg_node.setAttribute("width", 16 * this.width_per_byte + this.init_offset_x * 2);
        this.svg_node.setAttribute("height", this.outer_rect_height + (Math.ceil(layout.size / 16) - 1) * this.height_per_vector + this.init_offset_y + this.stroke_width * 2);
        this.CreateOuterRectGroup(layout);
        this.#VisualizeStruct(layout, null);
    }
};

export const BufferVisualizerOptionsDefault = {
    force_c_layout: false,
    check_matches_c_layout: true,
    expanded_arrays: true,
    text_alignment_min: 0,
    text_alignment_offset: 6,
    text_indent_width: 4,
    color_shuffle: false,
    color_shuffle_subdivisions: 4,
    color_lightness: 0.6,
    color_saturation: 0.6,
    color_hue_start: 290,
    color_hue_range: 360,
    svg_width_per_byte: 24,
    svg_outer_rect_height: 36,
    svg_hex_offsets: false,
    dark_theme: true
};
class MemberRecord {
    constructor(name, offset, size) {
        this.name = name;
        this.offset = offset;
        this.size = size;
    }
};
export class BufferVisualizer {
    constructor(out_text, out_svg, options) {
        this.out_text = out_text;
        this.out_svg = out_svg;
        this.options = options;
    }
    #GetColors() {
        let start = window.performance.now();
        let member_count = LayoutCountStructMembers(this.layout, this.options.expanded_arrays);
        this.colors = new ColorArray(member_count, this.options);
        window.performance.measure("GetColors", { start: start });
    }
    #ReEvaluateColors() {
        let start = window.performance.now();
        this.#GetColors();
        for (const svg_subnode of this.out_svg.children) {
            if (svg_subnode.CBV_color_index != undefined) {
                svg_subnode.setAttribute("stroke", this.colors.Get(svg_subnode.CBV_color_index));
            }
        }
        for (const span of this.out_text.children) {
            if (span.CBV_color_index != undefined) {
                span.style.color = this.colors.Get(span.CBV_color_index);
            }
        }
        window.performance.measure("ReEvaluateColors", { start: start });
    }
    #ApplyTheme() {
        let start = window.performance.now();
        this.#ReEvaluateColors();

        for (const child of this.out_svg.firstChild.children) { // outer rect group
            //if (this.out_svg.firstChild.tagName != "g")
            //    throw "Something went wrong when changing themes";
            if (child.tagName == "text")
                ApplyThemeOuterRectText(child, this.options.dark_theme);
            else if (child.tagName == "line")
                ApplyThemeOuterRectLine(child, this.options.dark_theme);
        }
        for (const svg_subnode of this.out_svg.children) {
            if (svg_subnode.CBV_color_index != undefined) { // inner rect
                let rect_text = svg_subnode.nextElementSibling.tagName == "text" ? svg_subnode.nextElementSibling : null;
                ApplyThemeInnerRect(svg_subnode, rect_text, this.options.dark_theme, svg_subnode.CBV_level);
            }
        }
        for (const span of this.out_text.children) {
            if (span.CBV_color_index != undefined) {
                span.style.color = this.colors.Get(span.CBV_color_index);
            }
        }
        window.performance.measure("ApplyTheme", { start: start });
    }
    #DoColoredText() {
        let start = window.performance.now();
        let printer = new StructPrinter(this.out_text, this.colors, this.options);
        printer.PrintColoredStructLayout(this.layout);
        window.performance.measure("DoColoredText", { start: start });
    }
    #DoColoredRects() {
        let start = window.performance.now();
        let viz = new StructLayoutVisualizer(this.out_svg, this.out_text, this.colors, this.options);
        viz.VisualizeLayout(this.layout);
        window.performance.measure("DoColoredRects", { start: start });
    }
    static #RecurseLayout(layout, func, context = null) {
        func(layout, context);
        for (let m of layout.submembers) {
            BufferVisualizer.#RecurseLayout(m, func, context);
        }
    }
    #RemoveEventListeners() {
        let start = window.performance.now();

        // disconnect text and rect nodes
        let remove_event_listeners = (member) => {
            if (member.CBV_rects != undefined) {
                for (let rect of member.CBV_rects) {
                    if (rect.rect.CBV_level != 0) {
                        rect.rect.removeEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                        rect.rect.removeEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                        rect.text?.removeEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                        rect.text?.removeEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                    }
                }
            }
            if (member.CBV_texts != undefined) {
                for (let span of member.CBV_texts) {
                    span.removeEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                    span.removeEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                }
            }
        };

        BufferVisualizer.#RecurseLayout(this.layout, remove_event_listeners);

        window.performance.measure("RemoveEventListeners", { start: start });
    }
    #AddEventListeners() {
        let start = window.performance.now();

        // connect text and rect nodes for highlighting
        // TODO: it feels cleaner to have it here, but we *could* put this in the StructLayoutVisualizer
        let add_event_listeners = (member) => {

            member.CBV_mouseenter = () => {
                let selection_bg_color = this.options.dark_theme ? "#04395e60" : "#0060c00a";
                if (member.CBV_rects != undefined) {
                    for (let rect of member.CBV_rects) {
                        rect.rect.setAttribute("stroke-width", 5);
                        rect.text?.setAttribute("style", "font-weight: bold;");
                    }
                }
                if (member.CBV_texts != undefined) {
                    for (let span of member.CBV_texts) {
                        span.setAttribute("style", `color: ${span.style.color}; font-weight: bold; background-color: ${selection_bg_color}; `);
                    }
                }
            };
            member.CBV_mouseleave = () => {
                if (member.CBV_rects != undefined) {
                    for (let rect of member.CBV_rects) {
                        rect.rect.setAttribute("stroke-width", 2); // TODO: this must be the same as stroke_width in StructLayoutVisualizer
                        rect.text?.setAttribute("style", "");
                    }
                }
                if (member.CBV_texts != undefined) {
                    for (let span of member.CBV_texts) {
                        span.setAttribute("style", `color: ${span.style.color};`);
                    }
                }
            };

            if (member.CBV_rects != undefined) {
                for (let rect of member.CBV_rects) {
                    if (rect.rect.CBV_level != 0) {
                        rect.rect.addEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                        rect.rect.addEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                        rect.text?.addEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                        rect.text?.addEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                    }
                }
            }
            if (member.CBV_texts != undefined) {
                for (let span of member.CBV_texts) {
                    span.addEventListener("mouseenter", member.CBV_mouseenter, { passive: true });
                    span.addEventListener("mouseleave", member.CBV_mouseleave, { passive: true });
                }
            }
        };

        BufferVisualizer.#RecurseLayout(this.layout, add_event_listeners);

        window.performance.measure("AddEventListeners", { start: start });
    }
    #CompareLayouts(a, b) {
        let members_a = [];
        let members_b = [];

        let RecordLayoutOffsetsSizes = (member, records) => {
            let size = member.size;
            // remove padding from end of inner structs because it doesn't matter for correctness whether the padding is inside or outside the type
            if (member.type instanceof StructType && !member.isGlobal) {
                let last_submember = member.submembers[member.submembers.length - 1];
                if (last_submember.padding > 0) {
                    size = member.size - last_submember.padding;
                }
            }
            // don't bother looking at arrays themselves, only the elements within them matter
            if (!(member.type instanceof ArrayType)) {
                records.push(new MemberRecord(member.name, member.offset, size));
            }
        };

        BufferVisualizer.#RecurseLayout(a, RecordLayoutOffsetsSizes, members_a);
        BufferVisualizer.#RecurseLayout(b, RecordLayoutOffsetsSizes, members_b);

        for (let i = 0; i < members_a.length; i++) {
            if ((members_a[i].offset != members_b[i].offset) || (members_a[i].size != members_b[i].size))
                return false;
        }

        return true;

    }
    #DoVisualization() {
        let start = window.performance.now();
        this.#GetColors();
        this.#DoColoredText();
        this.#DoColoredRects();
        this.#AddEventListeners();

        window.performance.measure("DoVisualization", { start: start });
    }
    #DoLayout() {
        let start = window.performance.now();

        let calc_cbuffer_layout = this.buffers[0].isCBuffer && (this.options.check_matches_c_layout || !this.options.force_c_layout);
        let calc_sbuffer_layout = !this.buffers[0].isCBuffer || this.options.check_matches_c_layout || this.options.force_c_layout;
        
        let cbuffer_layout = null;
        let sbuffer_layout = null;
        if (calc_cbuffer_layout)
            cbuffer_layout = new CBufferLayoutAlgorithm(this.buffers).GenerateLayout()[0];
        if (calc_sbuffer_layout)
            sbuffer_layout = new StructuredBufferLayoutAlgorithm(this.buffers).GenerateLayout()[0];

        if (this.options.force_c_layout) {
            sbuffer_layout.isSBuffer = false;
            this.layout = sbuffer_layout;
        }
        else if (this.buffers[0].isCBuffer)
            this.layout = cbuffer_layout;
        else
            this.layout = sbuffer_layout;

        let matches_c_layout = true;
        if (this.options.check_matches_c_layout && cbuffer_layout)
            matches_c_layout = this.#CompareLayouts(cbuffer_layout, sbuffer_layout);

        window.performance.measure("Layout Algorithm", { start: start });

        return matches_c_layout;
    }
    VisualizeBuffer(input) {
        let start = window.performance.now();

        this.input = input;
        let lexer = new Lexer(input);
        let parser = new Parser(lexer, this.options.force_c_layout);

        this.buffers = parser.ParseFile();
        if (this.buffers.length == 0)
            throw new HLSLError("Need at least one buffer to visualize!", lexer.line, 1, 2000);
        
        window.performance.measure("Parse", { start: start });

        let matches_c_layout = this.#DoLayout();

        this.#DoVisualization();

        return matches_c_layout;
    }
    SetForceCLayout(force_c_layout) {
        this.options.force_c_layout = force_c_layout;
        this.VisualizeBuffer(this.input);
    }
    SetExpandedArrays(expanded_arrays) {
        this.options.expanded_arrays = expanded_arrays;
        this.#DoVisualization();
    }
    SetTextAlignmentOffset(text_alignment_offset) {
        this.options.text_alignment_offset = text_alignment_offset;
        this.#RemoveEventListeners();
        this.#DoColoredText();
        this.#AddEventListeners();
    }
    SetTextIndentWidth(text_indent_width) {
        this.options.text_indent_width = text_indent_width;
        this.#RemoveEventListeners();
        this.#DoColoredText();
        this.#AddEventListeners();
    }
    SetSVGWidthPerByte(svg_width_per_byte) {
        this.options.svg_width_per_byte = svg_width_per_byte;
        this.#RemoveEventListeners();
        this.#DoColoredRects();
        this.#AddEventListeners();
    }
    SetSVGHexOffsets(svg_hex_offsets) {
        let was_hex = this.options.svg_hex_offsets;
        if (was_hex != svg_hex_offsets) {
            this.options.svg_hex_offsets = svg_hex_offsets;
            for (const child of this.out_svg.firstChild.children) { // outer rect group
                if (child.tagName == "text") { // offset text
                    if (was_hex)
                        child.textContent = parseInt(child.textContent, 16).toString();
                    else
                        child.textContent = Number(child.textContent).toString(16).toUpperCase();
                }
            }
        }
    }
    SetColorShuffle(color_shuffle) {
        this.options.color_shuffle = color_shuffle;
        this.#ReEvaluateColors();
    }
    SetColorShuffleSubdivisions(color_shuffle_subdivisions) {
        this.options.color_shuffle_subdivisions = color_shuffle_subdivisions;
        this.#ReEvaluateColors();
    }
    SetColorLightness(color_lightness) {
        this.options.color_lightness = color_lightness;
        this.#ReEvaluateColors();
    }
    SetColorSaturation(color_saturation) {
        this.options.color_saturation = color_saturation;
        this.#ReEvaluateColors();
    }
    SetColorHueStart(color_hue_start) {
        this.options.color_hue_start = color_hue_start;
        this.#ReEvaluateColors();
    }
    SetColorHueRange(color_hue_range) {
        this.options.color_hue_range = color_hue_range;
        this.#ReEvaluateColors();
    }
    SetDarkTheme(enable, color_lightness, color_saturation) {
        this.options.dark_theme = enable;
        this.options.color_lightness = color_lightness;
        this.options.color_saturation = color_saturation;
        this.#ApplyTheme();
    }
}