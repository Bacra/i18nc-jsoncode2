'use strict';

var _					= require('lodash');
var debug				= require('debug')('i18nc-jsoncode:generator');
var i18ncAst			= require('i18nc-ast');
var astTpl				= i18ncAst.tpl;
var astUtil				= i18ncAst.util;
var AST_FLAGS			= i18ncAst.AST_FLAGS;


exports.toTranslateJSON = toTranslateJSON;
/**
 * 生成i18nc翻译函数中的json数据格式
 * 生成TRANSLATE_DATA的数据格式
 * 同时，将重复的数据，使用index进行替换
 *
 * @param  {JSON} data mergeTranslateData  运行结果，整合了翻译结果的数据格式
 * @return {JSON}      test/output/generator/func_json.json
 */
function toTranslateJSON(data)
{
	var result = {};
	var LANGS = Object.keys(data).sort();
	if (LANGS.length) result.$ = LANGS;

	function _addkey(subtype, srcWord, targetWord, langIndex)
	{
		var obj = result[subtype] || (result[subtype] = {});
		var arr = obj[srcWord];
		if (arr)
		{
			var targetIndex = arr.indexOf(targetWord);
			if (targetIndex != -1) targetWord = targetIndex;
		}
		else
		{
			arr = obj[srcWord] = [];
		}

		arr[langIndex] = targetWord;
	}

	LANGS.forEach(function(lang, langIndex)
	{
		var lang_data = data[lang];

		_.each(lang_data.DEFAULTS, function(targetWord, srcWord)
		{
			_addkey('*', srcWord, targetWord, langIndex);
		});

		_.each(lang_data.SUBTYPES, function(item, subtype)
		{
			if (subtype == '*')
				throw new Error('`*` IS SYSTEM RESERVED FIELD');
			else if (subtype == '$')
				throw new Error('`$` IS SYSTEM RESERVED FIELD');
			else if ((''+subtype)[0] == '$')
				throw new Error('`$...` ARE SYSTEM RESERVED FIELD');

			_.each(item, function(targetWord, srcWord)
			{
				_addkey(subtype, srcWord, targetWord, langIndex);
			});
		});
	});

	return result;
}


exports.fillNoUsedCodeTranslateWords = fillNoUsedCodeTranslateWords;
/**
 * 针对toTranslateJSON结果，将没有翻译的词条，生成注释
 */
function fillNoUsedCodeTranslateWords(translateDataJSON, codeTranslateWords)
{
	var DEFAULTS_WORDS = _.uniq(codeTranslateWords.DEFAULTS);
	if (DEFAULTS_WORDS.length)
	{
		var result = translateDataJSON['*'] || (translateDataJSON['*'] = {});
		_.each(DEFAULTS_WORDS, function(word)
		{
			if (!result[word]) result[word] = null;
		});
	}

	_.each(codeTranslateWords.SUBTYPES, function(subtype_words, subtype)
	{
		var SUBTYPE_WORDS = _.uniq(subtype_words);
		if (!SUBTYPE_WORDS.length) return;

		var result = translateDataJSON[subtype] || (translateDataJSON[subtype] = {});
		_.each(SUBTYPE_WORDS, function(word)
		{
			if (!result[word]) result[word] = null;
		});
	});
}


exports.genTranslateJSONCode = genTranslateJSONCode;
/**
 * 结果转code
 */
function genTranslateJSONCode(translateData)
{
	debug('translateData:%o', translateData);

	var ast = _translateJSON2ast(translateData);
	if (ast)
	{
		var code = astUtil.tocode(ast);
		code = code.replace(/,?\s*(['"])\1 *: *null/g, '');
		return code;
	}
	else
	{
		return '{}';
	}
}


exports._translateJSON2ast = _translateJSON2ast;
/**
 * 将toTranslateJSON数据，转成ast表示
 * 对数据进行重新编排
 *
 * @param  {JSON} data toTranslateJSON  运行结果
 * @return {JSON}      test/output/generator/func_json.js
 */
function _translateJSON2ast(mainData)
{
	var resultPropertiesAst = [];
	var keys = Object.keys(mainData);
	keys = _.without(keys, '$', '*').sort();
	if (mainData['*']) keys.unshift('*');

	var lans = mainData.$;
	if (lans && lans.length)
	{
		var tmp = astTpl.ArrayExpression(lans.map(function(val)
		{
			return astUtil.constVal2ast(val);
		}));
		resultPropertiesAst.push(astTpl.Property('$', tmp));
	}

	_.each(keys, function(key)
	{
		resultPropertiesAst.push(astTpl.Property(key, _wordJson2ast(mainData[key])));
	});


	if (resultPropertiesAst.length)
	{
		return astTpl.ObjectExpression(resultPropertiesAst);
	}
}



exports._wordJson2ast = _wordJson2ast;
/**
 * 将array表示的或关系转成ast表示
 */
function _wordJson2ast(wordMap)
{
	if (!wordMap) return;
	var result = [];

	// 翻译为空的时候，把这些wordMap转化成注释
	var emptyTranslateComments = [];

	// 先对object进行排序，保证尽可能少触发svn变更
	Object.keys(wordMap).sort()
		.forEach(function(word)
		{
			var translateWords = wordMap[word];
			debug('wordJson2ast word:%s, translateWords:%o', word, translateWords);

			if (translateWords === null)
			{
				// 使用escodegen.generate替换JSON.stringify
				// JSON.stringify 会导致一些特殊字符不会encode，例如\u2029
				var keyStr = astUtil.tocode(astTpl.Literal(word));
				emptyTranslateComments.push(astTpl.LineComment(' '+keyStr+':'));
				return;
			}

			var valAst = translateWords.map(function(val)
			{
				if (val === undefined)
					return null;
				else if (val == '')
					return astTpl.ArrayExpression([]);
				else
					return astUtil.constVal2ast(val);
			});

			var retAst = astTpl.Property(word, astTpl.ArrayExpression(valAst));
			result.push(retAst);

			if (emptyTranslateComments.length)
			{
				retAst.leadingComments = emptyTranslateComments;
				emptyTranslateComments = [];
			}
		});

	if (emptyTranslateComments.length)
	{
		if (!result.length)
		{
			var protoKey = astTpl.Property('', astUtil.constVal2ast(null));
			astUtil.setAstFlag(protoKey, AST_FLAGS.PLACEHOLDER_WORDER);
			result.push(protoKey);
		}

		var lastItem = result[result.length-1];
		lastItem.leadingComments = (lastItem.leadingComments || []).concat(emptyTranslateComments);
	}

	return astTpl.ObjectExpression(result);
}
