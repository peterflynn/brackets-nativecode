/*
 * Copyright (c) 2014 Peter Flynn.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, regexp: true */
/*global define, brackets, $ */

/**
 * Utilities for working with C/C++ code
 */
define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var StringUtils         = brackets.getModule("utils/StringUtils"),
        FileSystem          = brackets.getModule("filesystem/FileSystem"),
        FileUtils           = brackets.getModule("file/FileUtils");
    

    /**
     * Function matching regular expression. Recognizes the forms:
     * (Newlines are accepted in whitespace positions, as with the other regexps below)
     * "type functionName(...) {"
     * "type class::functionName(...) {"
     * @const
     */
    var _functionDeclRegexp = /[_a-zA-Z][_a-zA-Z\d]*\s+([_a-zA-Z][_a-zA-Z\d]*::)?([_a-zA-Z][_a-zA-Z\d]*)\s*\([^)]*\)\s*\{/gm;
    
    /**
     * Function matching regular expression. Recognizes the forms:
     * "- (type)functionName {"
     * "- (type)functionName:(type)arg {"
     * "- (type)functionName:(type)arg arg:(type)arg arg:(type)arg {"
     * (and same with leading "+" instead)
     * @const
     */
    var _functionDeclRegexpObjC = /[\-+]\s\([_a-zA-Z][_a-zA-Z\d]*\)([_a-zA-Z][_a-zA-Z\d]*)\s*(:\([^)]+\)[_a-zA-Z][_a-zA-Z\d]*(\s+[_a-zA-Z][_a-zA-Z\d]*:\([^)]+\)[_a-zA-Z][_a-zA-Z\d]*)*)?\s*\{/gm;
    
    /**
     * Constructor/destructor matching regular expression. Recognizes the forms:
     * "class::class("
     * "class::~class("
     * @const
     */
    var _cdtorDeclRegexp = /([_a-zA-Z][_a-zA-Z\d]*)::(~?\1)\s*\(/gm;
    
    var keywords = "auto if break int case long char register continue return default short do sizeof " +
                   "double static else struct entry switch extern typedef float union for unsigned " +
                   "goto while enum void const signed volatile";
    keywords = keywords.split(" ");  // has to be separate line to avoid JSLint whining
    
    
    function findAllFunctionsC(text) {
        var lines = text.split("\n");
        
        var functionList = [];
        
        function add(index, functionName, displayName) {
            if (keywords.indexOf(functionName) !== -1) {
                return;
            }
            var lineStart = StringUtils.offsetToLineNum(lines, index),
                chFrom = lines[lineStart].indexOf(functionName),
                chTo = chFrom + functionName.length;
            functionList.push({
                line: lineStart,
                chFrom: chFrom,
                chTo: chTo,
//                functionName: displayName
                functionName: functionName
            });
        }
        
        var match, functionName, displayName;
        
        while ((match = _functionDeclRegexp.exec(text)) !== null) {
            functionName = match[2];
            displayName = (match[1] || "") + functionName;
            add(match.index, functionName, displayName);
        }
        while ((match = _cdtorDeclRegexp.exec(text)) !== null) {
            functionName = match[2];
            displayName = match[1] + "::" + functionName;
            add(match.index, functionName, displayName);
        }
        
        return functionList;
    }
    
    function findAllFunctionsObjC(text) {
        var lines = text.split("\n");
        
        var functionList = [];
        
        function add(index, functionName) {
            if (keywords.indexOf(functionName) !== -1) {
                return;
            }
            var lineStart = StringUtils.offsetToLineNum(lines, index),
                chFrom = lines[lineStart].indexOf(functionName),
                chTo = chFrom + functionName.length;
            functionList.push({
                line: lineStart,
                chFrom: chFrom,
                chTo: chTo,
                functionName: functionName
            });
        }
        
        var match, functionName;
        
        while ((match = _functionDeclRegexpObjC.exec(text)) !== null) {
            functionName = match[1];
            add(match.index, functionName);
        }
        
        return functionList;
    }
    
    
    /**
     * If the given line contains a #include using ""s, returns the relative path within the quotes as well as a
     * "best guess" abs path that assumes the include is relative to the document's location.
     * If no such #include found, returns null.
     */
    function getIncludeAt(doc, pos) {
        var line = doc.getLine(pos.line),
            match = line.match(/^#include\s+"([^"]+)"/);
        
        if (match) {
            var relPath = match[1];
            return {
                relPath: relPath,
                topGuess: FileUtils.getDirectoryPath(doc.file.fullPath) + relPath
            };
        }
        return null;
    }
    
    
    /**
     * Given a source file, finds its header file. Given a header file, finds its source file. If no match can be found
     * that exists on disk, the promise is rejected.
     * @param {!File} file
     * @return {!Promise.<File>}
     */
    function findHeaderMatch(file) {
        var basename = FileUtils.getFilenameWithoutExtension(file.fullPath);
        var result = new $.Deferred();
        
        function findFirstExtension(extensions, i) {
//            console.log("findFirstExtension", extensions, i);
            if (i >= extensions.length) {
                console.log("Giving up");
                result.reject();
                return;
            }
//            console.log("Trying file", basename + "." + extensions[i]);
            FileSystem.resolve(basename + "." + extensions[i], function (err, file) {
                if (err) {
                    findFirstExtension(extensions, i + 1);
                } else {
                    result.resolve(file);
                }
            });
        }
        
        var headerExtensions = ["h", "hpp", "hh"];
        var sourceExtensions = ["c", "cpp", "m", "mm"];
        
        var ext = FileUtils.getFileExtension(file.name);
        if (headerExtensions.indexOf(ext) !== -1) {
            findFirstExtension(sourceExtensions, 0);
        } else {
            findFirstExtension(headerExtensions, 0);
        }
        return result;
    }
    
    
    exports.findAllFunctionsC       = findAllFunctionsC;
    exports.findAllFunctionsObjC    = findAllFunctionsObjC;
    exports.getIncludeAt            = getIncludeAt;
    exports.findHeaderMatch         = findHeaderMatch;
});
