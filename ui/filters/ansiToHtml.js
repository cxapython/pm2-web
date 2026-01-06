var ansiHTML = require("ansi-html"),
	htmlEntities = require("html-entities");

module.exports = ["$sce", function($sce) {

	// don't force background color
	ansiHTML.tags.open[0] = ansiHTML.tags.open[0].replace("color:#000;", "");

	return function(text) {
		var encoded = htmlEntities.encode(text);

		return $sce.trustAsHtml(ansiHTML(encoded));
	}
}];
