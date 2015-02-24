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
 * Provides some basic functionality for editing C/C++/ObjectiveC code:
 *  - Expose CodeMirror's Objective-C mode in Brackets
 *  - Add new Objective-C++ mode
 *  - Ctrl-T (Quick Find Definition) for function declarations within a file (C, C++, Objective-C syntax)
 *  - Ctrl-J (Jump to Definition) on #include lines jumps to included file - with fuzzy matching, since compiler search path is unknown
 *  - Ctrl-Shift-J to jump from header to src file, or vice versa, regardless of cursor position
 *  - Add .xib to XML language file extensions list
 * 
 * TODO:
 *  - contribute clike changes back to CodeMirror
 *  - clike should color tokens after . or -> or :: differently, as JS mode does? or is hat too language-specific?
 *  - Quick Edit function definition search across files (without type knowledge - just name matching like old JS)
 *  - only enable the extra cm-meta CSS when a C/etc. file is active
 */
define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var _                   = brackets.getModule("thirdparty/lodash"),
        CommandManager      = brackets.getModule("command/CommandManager"),
        Commands            = brackets.getModule("command/Commands"),
        Menus               = brackets.getModule("command/Menus"),
        LanguageManager     = brackets.getModule("language/LanguageManager"),
        ExtensionUtils      = brackets.getModule("utils/ExtensionUtils"),
        EditorManager       = brackets.getModule("editor/EditorManager"),
        FileSystem          = brackets.getModule("filesystem/FileSystem"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        ProjectManager      = brackets.getModule("project/ProjectManager"),
        QuickOpen           = brackets.getModule("search/QuickOpen");
    
    // Our own modules
    var CUtils              = require("CUtils"),
        clike_mods          = require("clike_mods");
    
    
    function filterAndSort(query, matcher, functionList) {
        query = query.substr(1);  // lose the "@" prefix
      
        // Filter and rank how good each match is (& convert to SearchResult objs)
        var filteredList = $.map(functionList, function (info) {
            var searchResult = matcher.match(info.functionName, query);
            if (searchResult) {
                searchResult.info = info;
            }
            return searchResult;
        });
        
        // Sort based on ranking & basic alphabetical order
        QuickOpen.basicMatchSort(filteredList);
        
        return filteredList;
    }
    
    /**
     * Search function for C/C++
     * @param {string} query User query/filter string
     * @return {Array.<SearchResult>} Sorted and filtered results that match the query
     */
    function searchC(query, matcher) {
        var functionList = matcher.functionList;
        if (!functionList) {
            functionList = CUtils.findAllFunctionsC(DocumentManager.getCurrentDocument().getText());
            matcher.functionList = functionList;
        }

        return filterAndSort(query, matcher, functionList);
    }

    /**
     * Search function for Objective-C/C++
     * @param {string} query User query/filter string
     * @return {Array.<SearchResult>} Sorted and filtered results that match the query
     */
    function searchObjC(query, matcher) {
        var functionList = matcher.functionList;
        if (!functionList) {
            functionList = CUtils.findAllFunctionsObjC(DocumentManager.getCurrentDocument().getText());
            matcher.functionList = functionList;
        }

        return filterAndSort(query, matcher, functionList);
    }
    
    /**
     * Select the selected item in the current document
     * @param {?SearchResult} selectedItem
     */
    function itemFocus(selectedItem) {
        if (!selectedItem) {
            return;
        }
        var info = selectedItem.info;

        var from = {line: info.line, ch: info.chFrom};
        var to   = {line: info.line, ch: info.chTo};
        EditorManager.getCurrentFullEditor().setSelection(from, to, true);
    }

    function itemSelect(selectedItem) {
        itemFocus(selectedItem);
    }

    /**
     * @param {string} query
     * @return {boolean} true if this plugin wants to provide results for this query
     */
    function match(query) {
        return query[0] === "@";
    }
    
    
    
    function fuzzyFindFile(includeInfo) {
        var result = new $.Deferred();
        FileSystem.resolve(includeInfo.topGuess, function (err, entry) {
            if (entry && entry.isFile) {
                result.resolve(entry);
            } else {
                ProjectManager.getAllFiles()
                    .done(function (allFiles) {
                        var fuzzyMatches = allFiles.filter(function (file) {
                            return file.fullPath.substr(-includeInfo.relPath.length) === includeInfo.relPath;
                        });
                        if (fuzzyMatches.length) {
//                            var bestMatch = _.min(fuzzyMatches, function (file) {
//                                // TODO: 'distance' from current file? - e.g. how long is the common prefix of cur editor & this file?
//                            });
                            var bestMatch = fuzzyMatches[0];
                            result.resolve(bestMatch);
                        } else {
                            result.reject(); // no matching files found
                        }
                    }).fail(function () {
                        result.reject(); // project too large to search
                    });
            }
        });
        return result;
    }
    
    function jumpToInclude(editor, pos) {
        var lang = editor.document.getLanguage().getId();
        if (lang === "cpp" || lang === "c" || lang === "objectivec" || lang === "objectivecpp") {
            var includeInfo = CUtils.getIncludeAt(editor.document, pos);
            if (includeInfo) {
                return fuzzyFindFile(includeInfo).then(function (file) {
                    return CommandManager.execute(Commands.FILE_OPEN, {fullPath: file.fullPath});
                });
            }
        }
        return null;
    }
    
    function jumpToFromHeader() {
        var editor = EditorManager.getActiveEditor();
        var lang = editor.document.getLanguage().getId();
        if (lang === "cpp" || lang === "c" || lang === "objectivec" || lang === "objectivecpp") {
            CUtils.findHeaderMatch(editor.document.file).done(function (altFile) {
                CommandManager.execute(Commands.FILE_OPEN, {fullPath: altFile.fullPath});
            });
        }
    }
    
    
    // Register Objective-C language, which isn't in core Brackets. The language id should be usable immediately since
    // "clike" has already been loaded by core
    LanguageManager.defineLanguage("objectivec", {
        name: "Objective-C",
        "mode": ["clike", "text/x-objectivec"],
        "fileExtensions": ["m"],
        "blockComment": ["/*", "*/"],
        "lineComment": ["//"]
    });
    
    // Register Objetive-C++ language based on mimetype defined in clike_mods.js
    LanguageManager.defineLanguage("objectivecpp", {
        name: "Objective-C++",
        "mode": ["clike", "text/x-objectivec++"],
        "fileExtensions": ["mm"],
        "blockComment": ["/*", "*/"],
        "lineComment": ["//"]
    });
    
    // Add .xib to XML language file extensions list
    LanguageManager.getLanguage("xml").addFileExtension("xib");

    
    // Register providers
    QuickOpen.addQuickOpenPlugin(
        {
            name: "C/C++ Functions",
            languageIds: ["c", "cpp"],
            done: function () {},
            search: searchC,
            match: match,
            itemFocus: itemFocus,
            itemSelect: itemSelect,
            resultsFormatter: null  // use default
        }
    );
    QuickOpen.addQuickOpenPlugin(
        {
            name: "Objective-C Functions",
            languageIds: ["objectivec", "objectivecpp"],
            done: function () {},
            search: searchObjC,
            match: match,
            itemFocus: itemFocus,
            itemSelect: itemSelect,
            resultsFormatter: null  // use default
        }
    );
    
    EditorManager.registerJumpToDefProvider(jumpToInclude);
    
    var CMD_JUMP_HEADER = "pflynn.cpp.jumpToFromHeader";
    CommandManager.register("Jump to/from Header", CMD_JUMP_HEADER, jumpToFromHeader);
    Menus.getMenu(Menus.AppMenuBar.NAVIGATE_MENU).addMenuItem(CMD_JUMP_HEADER, "Ctrl-Shift-J", Menus.AFTER, Commands.NAVIGATE_JUMPTO_DEFINITION);
    
    // Styles - override @accent-meta, which is normally the same color as plain text
    // The '!important' is needed because extension stylesheets load before Brackets core's stylesheet (!)
    ExtensionUtils.addEmbeddedStyleSheet("span.cm-meta {color: #0c6900 !important;}");
});
