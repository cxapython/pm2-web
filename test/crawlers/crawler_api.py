#!/usr/bin/env python3
"""
测试爬虫 2：API 请求测试
不断请求公共 API 来产生网络流量
"""
import urllib.request
import json
import time
import sys

# 公共 API 列表
API_URLS = [
    "https://httpbin.org/get",
    "https://jsonplaceholder.typicode.com/posts",
    "https://jsonplaceholder.typicode.com/comments",
    "https://api.github.com/repos/nodejs/node",
    "https://httpbin.org/headers",
    "https://jsonplaceholder.typicode.com/users",
]

def fetch_api(url):
    """请求 API 并返回数据大小"""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Test Crawler)',
            'Accept': 'application/json'
        })
        
        start_time = time.time()
        with urllib.request.urlopen(req, timeout=15) as response:
            data = response.read()
            elapsed = time.time() - start_time
            size = len(data)
            
            print(f"[API] {url}", flush=True)
            print(f"      大小: {size} bytes, 耗时: {elapsed:.2f}s", flush=True)
            
            return size
            
    except Exception as e:
        print(f"[API] 错误 {url}: {e}", flush=True)
        return 0

def main():
    print("=" * 50, flush=True)
    print("API 测试爬虫启动", flush=True)
    print("=" * 50, flush=True)
    
    total_bytes = 0
    request_count = 0
    start_time = time.time()
    
    while True:
        for url in API_URLS:
            size = fetch_api(url)
            total_bytes += size
            request_count += 1
            
            # 每 10 次请求打印统计
            if request_count % 10 == 0:
                elapsed = time.time() - start_time
                avg_speed = total_bytes / elapsed if elapsed > 0 else 0
                print(f"[统计] 请求数: {request_count}, 总流量: {total_bytes / 1024:.2f} KB, 平均速度: {avg_speed / 1024:.2f} KB/s", flush=True)
            
            # 请求间隔 0.5 秒
            time.sleep(0.5)
        
        # 一轮完成后等待 2 秒
        print(f"[API] 一轮完成，等待 2 秒...", flush=True)
        time.sleep(2)

if __name__ == "__main__":
    main()
