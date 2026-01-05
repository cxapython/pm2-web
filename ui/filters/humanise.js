var Moment = require("moment");

// 设置中文 locale
Moment.locale('zh-cn', {
	relativeTime: {
		future: '%s后',
		past: '%s前',
		s: '几秒',
		ss: '%d秒',
		m: '1分钟',
		mm: '%d分钟',
		h: '1小时',
		hh: '%d小时',
		d: '1天',
		dd: '%d天',
		M: '1个月',
		MM: '%d个月',
		y: '1年',
		yy: '%d年'
	}
});

module.exports = function() {
	return function(date) {
		return Moment.duration(date, "seconds").locale('zh-cn').humanize();
	}
};
