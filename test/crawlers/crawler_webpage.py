#!/usr/bin/env python3
"""
测试爬虫 3：网页抓取测试
抓取真实网页来产生网络流量
"""
import urllib.request
import time
import sys
import re

# 测试网页列表
WEB_URLS = [
    "https://www.wikipedia.org/",
    "https://news.ycombinator.com/",
    "https://github.com/trending",
    "https://stackoverflow.com/questions",
    "https://www.reddit.com/r/programming/.json",
    "https://httpbin.org/html",
]

def fetch_webpage(url):
    """抓取网页并统计流量"""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        })
        
        start_time = time.time()
        with urllib.request.urlopen(req, timeout=15) as response:
            data = response.read()
            elapsed = time.time() - start_time
            size = len(data)
            
            # 尝试提取页面标题
            try:
                content = data.decode('utf-8', errors='ignore')
                title_match = re.search(r'<title[^>]*>([^<]+)</title>', content, re.IGNORECASE)
                title = title_match.group(1).strip()[:50] if title_match else "无标题"
            except:
                title = "无法解析"
            
            print(f"[网页] {url}", flush=True)
            print(f"       标题: {title}", flush=True)
            print(f"       大小: {size / 1024:.2f} KB, 耗时: {elapsed:.2f}s", flush=True)
            
            return size
            
    except Exception as e:
        print(f"[网页] 错误 {url}: {e}", flush=True)
        return 0

def main():
    print("=" * 50, flush=True)
    print("网页抓取测试爬虫启动", flush=True)
    print("=" * 50, flush=True)
    
    total_bytes = 0
    page_count = 0
    start_time = time.time()
    
    while True:
        for url in WEB_URLS:
            size = fetch_webpage(url)
            total_bytes += size
            page_count += 1
            
            elapsed = time.time() - start_time
            avg_speed = total_bytes / elapsed if elapsed > 0 else 0
            
            print(f"[统计] 页面数: {page_count}, 总流量: {total_bytes / 1024:.2f} KB, 平均: {avg_speed / 1024:.2f} KB/s", flush=True)
            print("-" * 40, flush=True)
            
            # 请求间隔 1 秒
            time.sleep(1)
        
        # 一轮完成后等待 3 秒
        print(f"[网页] 一轮完成，等待 3 秒...", flush=True)
        time.sleep(3)

if __name__ == "__main__":
    main()
