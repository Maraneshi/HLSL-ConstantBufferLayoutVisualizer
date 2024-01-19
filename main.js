export { GetSupportedKeywords } from './cbuffer_parser.js';
import { CBufferVisualizer } from './cbuffer_visualizer.js';
export { CBufferVisualizerOptionsDefault } from './cbuffer_visualizer.js';
import { hlsl_lang_config, hlsl_lang_def } from "./hlsl_monaco.js";
import { Lexer, TokenType } from './cbuffer_parser.js';

const dark_theme_sheet = document.querySelector('[title="CBV Dark Theme"]');
function ApplyLightTheme() {
    dark_theme_sheet.disabled = true;
    window.monaco?.editor.setTheme('vs');
    CBV_color_lightness.value = 0.72;
    CBV_color_lightness_value.value = 0.72;
    CBV_color_saturation.value = 1.0;
    CBV_color_saturation_value.value = 1.0;
    window.CBV_VisualizerObject?.SetDarkTheme(false, CBV_color_lightness.valueAsNumber, CBV_color_saturation.valueAsNumber);
    window.CBV_ExampleVisualizers?.SetDarkTheme(false, CBV_color_lightness.valueAsNumber, CBV_color_saturation.valueAsNumber);
}

function ApplyDarkTheme() {
    dark_theme_sheet.disabled = false;
    window.monaco?.editor.setTheme('vs-dark');
    CBV_color_lightness.value = 0.60;
    CBV_color_lightness_value.value = 0.60;
    CBV_color_saturation.value = 0.60;
    CBV_color_saturation_value.value = 0.60;
    window.CBV_VisualizerObject?.SetDarkTheme(true, CBV_color_lightness.valueAsNumber, CBV_color_saturation.valueAsNumber);
    window.CBV_ExampleVisualizers?.SetDarkTheme(true, CBV_color_lightness.valueAsNumber, CBV_color_saturation.valueAsNumber);
}

export function SetDarkTheme(enable) {
    if (enable)
        ApplyDarkTheme();
    else
        ApplyLightTheme();
}

export function CreateMonacoEditor(parent) {
    monaco.languages.register({ id: "hlsl" });
    monaco.languages.setMonarchTokensProvider('hlsl', hlsl_lang_def);
    monaco.languages.setLanguageConfiguration('hlsl', hlsl_lang_config);

    const editor = monaco.editor.create(parent, {
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
        language: 'hlsl',
        minimap: { enabled: false },
        automaticLayout: true,
        theme: 'vs-dark',
        scrollBeyondLastLine: false
    });
    parent.style.height = editor.getContentHeight() + 'px';
    return editor;
}

function DoSyntaxHighlighting(input_node) {
    // Recreate the original code with proper formatting and syntax highlighting.
    // This sucks, but not as much as having to make the spans by hand.
    let start = window.performance.now();
    let lexer = new Lexer(input_node.textContent);
    let tokens = lexer.GetAllTokens();

    input_node.replaceChildren("\n");

    const no_space_after = [';', '[', '<'];
    const no_space_before = [';', '[', ']', ',', '<', '>'];
    const brackets = ["{", "}", "[", "]", "(", ")", '<', '>'];

    let indent = 0;
    for (let i = 0; i < tokens.length; i++) {
        let t = tokens[i];
        let next = tokens[i + 1];
        
        let node = document.createElement("span");
        node.append(t.value);

        if (t.type == TokenType.Number)
            node.className = "number";
        else if (hlsl_lang_def.keywords.indexOf(t.value) != -1)
            node.className = "keyword";
        else if (brackets.indexOf(t.value) != -1)
            node.className = "bracket" + Math.min(indent, 2);

        if ((no_space_after.indexOf(t.type) == -1) && (!next || (no_space_before.indexOf(next.type) == -1)))
            node.append(" ");

        input_node.append(node);

        if (t.type == '{')
            indent++;
        else if (next && next.type == '}')
            indent--;

        let indent_str = "    ".repeat(indent);

        if (t.type == '{' || t.type == ';')
            input_node.append('\n' + indent_str);
    }
    window.performance.measure("Syntax Highlighting", { start: start });
}

export class CBufferVisualizerList {
    constructor() {
        this.list = [];
    }
    Push(viz) {
        this.list.push(viz);
    }
    SetExpandedArrays(expanded_arrays) {
        for (let viz of this.list) {
            viz.SetExpandedArrays(expanded_arrays);
        }
    }
    SetTextAlignment(text_alignment) {
        for (let viz of this.list) {
            viz.SetTextAlignment(text_alignment);
        }
    }
    SetColorShuffle(color_shuffle) {
        for (let viz of this.list) {
            viz.SetColorShuffle(color_shuffle);
        }
    }
    SetColorShuffleSubdivisions(color_shuffle_subdivisions) {
        for (let viz of this.list) {
            viz.SetColorShuffleSubdivisions(color_shuffle_subdivisions);
        }
    }
    SetColorLightness(color_lightness) {
        for (let viz of this.list) {
            viz.SetColorLightness(color_lightness);
        }
    }
    SetColorSaturation(color_saturation) {
        for (let viz of this.list) {
            viz.SetColorSaturation(color_saturation);
        }
    }
    SetColorHueStart(hue_start) {
        for (let viz of this.list) {
            viz.SetColorHueStart(hue_start);
        }
    }
    SetColorHueRange(hue_range) {
        for (let viz of this.list) {
            viz.SetColorHueRange(hue_range);
        }
    }
    SetDarkTheme(enable, color_lightness, color_saturation) {
        for (let viz of this.list) {
            viz.SetDarkTheme(enable, color_lightness, color_saturation);
        }
    }
}

export function ParseHLSLAndVisualizeTextNode(input_node, out_text, out_svg, options) {
    try {
        let start = window.performance.now();
        let input = input_node.textContent;
        let viz = new CBufferVisualizer(out_text, out_svg, options);
        viz.VisualizeCBuffer(input);

        DoSyntaxHighlighting(input_node);

        window.performance.measure("ParseHLSLAndVisualize", { start: start });
        return viz;
    }
    catch (error) {
        out_svg.replaceChildren();
        out_text.replaceChildren(`ERROR(${error.line}:${error.start_column}): ${error.message}`);
        return null;
    }
}

export function ParseHLSLAndVisualizeMonaco(editor, out_text, out_svg, options) {
    let start = window.performance.now();

    monaco.editor.setModelMarkers(CBV_monaco_editor.getModel(), "owner", []);

    try {
        let input = editor.getValue();
        let viz = new CBufferVisualizer(out_text, out_svg, options);
        viz.VisualizeCBuffer(input);
        window.performance.measure("ParseHLSLAndVisualize", { start: start });
        return viz;
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
        monaco.editor.setModelMarkers(CBV_monaco_editor.getModel(), "owner", markers);
        
        out_svg.replaceChildren();
        out_text.replaceChildren(`ERROR(${error.line}:${error.start_column}): ${error.message}`);
        return null;
    }
}

export function EnableResizer(resizer, vertical) {
    // Query the element
    const prev = resizer.previousElementSibling;
    const next = resizer.nextElementSibling;

    // The current position of mouse
    let x = 0;
    let y = 0;
    let leftWidth = 0;
    let topHeight = 0;

    // Handle the mousedown event
    // that's triggered when user drags the resizer
    const mouseDownHandler = function (e) {
        e.preventDefault();
        // Get the current mouse position
        x = e.clientX;
        y = e.clientY;
        leftWidth = prev.getBoundingClientRect().width;
        topHeight = prev.getBoundingClientRect().height;

        // Attach the listeners to document
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    };

    const mouseMoveHandler = function (e) {
        e.preventDefault();
        // How far the mouse has been moved
        const dx = (e.clientX - x) * 2; // HACK: since the element now grows to the left *and* right due to the flex centering, we need to double this
        const dy = e.clientY - y;

        if (vertical) {
            const newTopHeight = (topHeight + dy);
            prev.style.height = newTopHeight + 'px';
            resizer.style.cursor = 'row-resize';
            document.body.style.cursor = 'row-resize';
        }
        else {
            const newLeftWidth = (leftWidth + dx);
            prev.style.width = newLeftWidth + 'px';
            resizer.style.cursor = 'col-resize';
            document.body.style.cursor = 'col-resize';
        }

        prev.style.userSelect = 'none';
        prev.style.pointerEvents = 'none';

        next.style.userSelect = 'none';
        next.style.pointerEvents = 'none';
    };

    const mouseUpHandler = function (e) {
        e.preventDefault();
        resizer.style.removeProperty('cursor');
        document.body.style.removeProperty('cursor');

        prev.style.removeProperty('user-select');
        prev.style.removeProperty('pointer-events');

        next.style.removeProperty('user-select');
        next.style.removeProperty('pointer-events');

        // Remove the handlers of mousemove and mouseup
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
    };

    // Attach the handler
    resizer.addEventListener('mousedown', mouseDownHandler);
}
