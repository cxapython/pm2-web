
module.exports = ["config", function(config) {
	return {
		restrict: "A",
		scope: {
			data: "="
		},
		link: function($scope, $element, $attributes) {
			var data = {
				"xScale": "time",
				"yScale": "linear",
				"type": "line",
				"main": [{
						"className": ".cpu",
						"data": $scope.data.cpu
					}, {
						"className": ".memory",
						"data": $scope.data.memory
					}
				]
			};

			// 检查是否有 I/O 数据
			var hasIOData = $scope.data.io_read && $scope.data.io_write;
			
			// 配置 Y 轴
			var yAxisConfig = [{
				title: {
					text: null
				},
				labels: {
					format: "{value}%"
				},
				min: 0,
				max: 100,
				gridLineColor: "#EEEEEE"
			}];
			
			// 如果有 I/O 数据，添加第二个 Y 轴
			if (hasIOData) {
				yAxisConfig.push({
					title: {
						text: null
					},
					labels: {
						format: "{value} KB/s",
						style: {
							color: "#06b6d4"
						}
					},
					min: 0,
					gridLineColor: "#EEEEEE",
					opposite: true
				});
			}
			
			// 基础系列配置
			var seriesConfig = [{
				name: "CPU",
				color: "#3b82f6",
				data: $scope.data.cpu,
				yAxis: 0
			}, {
				name: "内存",
				color: "#22c55e",
				data: $scope.data.memory,
				yAxis: 0
			}];
			
			// 添加 I/O 系列
			if (hasIOData) {
				seriesConfig.push({
					name: "读取 I/O",
					color: "#06b6d4",
					data: $scope.data.io_read,
					yAxis: 1,
					dashStyle: "ShortDash"
				});
				seriesConfig.push({
					name: "写入 I/O",
					color: "#a855f7",
					data: $scope.data.io_write,
					yAxis: 1,
					dashStyle: "ShortDash"
				});
			}

			var chart = new Highcharts.Chart({
				chart: {
					type: "areaspline",
					renderTo: $element[0],
					backgroundColor: "transparent"
				},
				title: {
					text: null
				},
				legend: {
					enabled: hasIOData,
					align: "right",
					verticalAlign: "top",
					floating: true,
					itemStyle: {
						color: "#64748b",
						fontSize: "11px"
					}
				},
				credits: {
					enabled: false
				},
				exporting: {
					enabled: false
				},
				xAxis: {
					type: "datetime",
					labels: {
						overflow: "justify",
						y: 25,
						style: {
							color: "#64748b"
						}
					},
					gridLineColor: "#334155",
					gridLineWidth: 1,
					lineColor: "#334155"
				},
				yAxis: yAxisConfig,
				tooltip: {
					shared: true,
					useHTML: true,
					backgroundColor: "rgba(30, 41, 59, 0.95)",
					borderColor: "#334155",
					style: {
						color: "#f1f5f9"
					},
					formatter: function() {
						var s = "<b>" + Highcharts.dateFormat("%Y-%m-%d %H:%M:%S", this.x) + "</b><br/>";
						this.points.forEach(function(point) {
							var suffix = point.series.yAxis.options.index === 0 ? "%" : " KB/s";
							s += '<span style="color:' + point.series.color + '">\u25CF</span> ' + 
								point.series.name + ": <b>" + point.y.toFixed(2) + suffix + "</b><br/>";
						});
						return s;
					}
				},
				plotOptions: {
					areaspline: {
						lineWidth: 2,
						states: {
							hover: {
								lineWidth: 3
							}
						},
						marker: {
							enabled: false,
							states: {
								hover: {
									enabled: true,
									radius: 4
								}
							}
						},
						fillOpacity: 0.1
					}
				},
				series: seriesConfig
			});

			// much simpler than $scope.$watchCollection
			setInterval(function() {
				chart.series[0].setData($scope.data.cpu, true);
				chart.series[1].setData($scope.data.memory, true);
				
				// 更新 I/O 数据
				if (hasIOData && chart.series.length >= 4) {
					chart.series[2].setData($scope.data.io_read || [], true);
					chart.series[3].setData($scope.data.io_write || [], true);
				}
			}, config.get("updateFrequency"));
		}
	};
}];
