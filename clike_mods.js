// Based on code from:
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, regexp: true */
/*global define, brackets */

/**
 * Patches/extensions to the default CodeMirror clike mode:
 * 
 * - Create CodeMirror mimetype for Objective-C++, cominbing elements of Objective-C & C++ mimetypes
 * 
 */
define(function (require, exports, module) {
    "use strict";
    
    var CodeMirror = brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
    
    
    function toMap(str) {
        var obj = {};
        str.split(" ").forEach(function (word) {
            obj[word] = true;
        });
        return obj;
    }
    
    // (unmodified from CodeMirror clike mode)
    function cppHook(stream, state) {
        if (!state.startOfLine) { return false; }
        for (;;) {
            if (stream.skipTo("\\")) {
                stream.next();
                if (stream.eol()) {
                    state.tokenize = cppHook;
                    break;
                }
            } else {
                stream.skipToEnd();
                state.tokenize = null;
                break;
            }
        }
        return "meta";
    }
    
    // (unmodified from CodeMirror clike mode)
    function tokenRawString(stream, state) {
        // Escape characters that have special regex meanings.
        var delim = state.cpp11RawStringDelim.replace(/[^\w\s]/g, '\\$&');
        var match = stream.match(new RegExp(".*?\\)" + delim + '"'));
        if (match) {
            state.tokenize = null;
        } else {
            stream.skipToEnd();
        }
        return "string";
    }
    
    // (unmodified from CodeMirror clike mode)
    function cpp11StringHook(stream, state) {
        stream.backUp(1);
        // Raw strings.
        if (stream.match(/(R|u8R|uR|UR|LR)/)) {
            var match = stream.match(/"([^\s\\()]{0,16})\(/);
            if (!match) {
                return false;
            }
            state.cpp11RawStringDelim = match[1];
            state.tokenize = tokenRawString;
            return tokenRawString(stream, state);
        }
        // Unicode strings/chars.
        if (stream.match(/(u8|u|U|L)/)) {
            if (stream.match(/["']/, /* eat */ false)) {
                return "string";
            }
            return false;
        }
        // Ignore this hook.
        stream.next();
        return false;
    }
    
    
    var cKeywords = "auto if break int case long char register continue return default short do sizeof " +
        "double static else struct entry switch extern typedef float union for unsigned " +
        "goto while enum void const signed volatile";
    var cppKeywords = " asm dynamic_cast namespace reinterpret_cast try bool explicit new " +
        "static_cast typeid catch operator template typename class friend private " +
        "this using const_cast inline public throw virtual delete mutable protected " +
        "wchar_t alignas alignof constexpr decltype nullptr noexcept thread_local final " +
        "static_assert override";
    var objcKeywords = "inline restrict _Bool _Complex _Imaginery BOOL Class bycopy byref id IMP in " +
        "inout nil oneway out Protocol SEL self super atomic nonatomic retain copy readwrite readonly";
    
    CodeMirror.defineMIME("text/x-objectivec++", {
        name: "clike",
        keywords: toMap(cKeywords + cppKeywords + objcKeywords),
        atoms: toMap("YES NO NULL NILL ON OFF true false null"),
        blockKeywords: toMap("catch class do else finally for if struct switch try while"),
        hooks: {
            "@": function(stream) {
                stream.eatWhile(/[\w\$]/);
                return "keyword";
            },
            "#": cppHook,
            "u": cpp11StringHook,
            "U": cpp11StringHook,
            "L": cpp11StringHook,
            "R": cpp11StringHook
        },
        modeProps: {fold: ["brace", "include"]}
    });
    
    
    // TODO: need CodeMirror.registerHelper("hintWords", ...) call ?
    
});
