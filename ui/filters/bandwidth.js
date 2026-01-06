
/**
 * 带宽速度格式化过滤器
 * 将字节/秒转换为人类可读的格式
 */
module.exports = function() {
	var sizes = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];

	return function(bytesPerSecond) {
		if(!bytesPerSecond && bytesPerSecond !== 0) {
			return "0 B/s";
		}
		
		bytesPerSecond = Math.abs(bytesPerSecond);

		for(var i = sizes.length - 1; i > 0; i--) {
			var step = Math.pow(1024, i);

			if (bytesPerSecond >= step) {
				return (bytesPerSecond / step).toFixed(2) + " " + sizes[i];
			}
		}

		return bytesPerSecond.toFixed(0) + " " + sizes[0];
	}
};
