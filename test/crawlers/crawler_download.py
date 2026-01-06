#!/usr/bin/env python3
"""
测试爬虫 1：下载大文件测试
不断下载文件来产生网络流量
"""
import urllib.request
import time
import sys

# 测试下载的 URL 列表（公共测试文件）
TEST_URLS = [
    "https://speed.hetzner.de/100MB.bin",
    "https://proof.ovh.net/files/10Mb.dat",
    "http://ipv4.download.thinkbroadband.com/10MB.zip",
    "https://ash-speed.hetzner.com/100MB.bin",
]

def download_file(url, chunk_size=8192):
    """下载文件并统计流量"""
    try:
        print(f"[下载] 开始下载: {url}", flush=True)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        
        with urllib.request.urlopen(req, timeout=30) as response:
            total = 0
            start_time = time.time()
            
            while True:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                total += len(chunk)
                
                # 每下载 1MB 打印一次进度
                if total % (1024 * 1024) < chunk_size:
                    elapsed = time.time() - start_time
                    speed = total / elapsed / 1024 if elapsed > 0 else 0
                    print(f"[下载] 已下载: {total / 1024 / 1024:.2f} MB, 速度: {speed:.2f} KB/s", flush=True)
                
                # 限制最多下载 20MB
                if total > 20 * 1024 * 1024:
                    print(f"[下载] 达到限制，停止下载", flush=True)
                    break
            
            elapsed = time.time() - start_time
            speed = total / elapsed / 1024 if elapsed > 0 else 0
            print(f"[下载] 完成! 总计: {total / 1024 / 1024:.2f} MB, 平均速度: {speed:.2f} KB/s", flush=True)
            return total
            
    except Exception as e:
        print(f"[下载] 错误: {e}", flush=True)
        return 0

def main():
    print("=" * 50, flush=True)
    print("下载测试爬虫启动", flush=True)
    print("=" * 50, flush=True)
    
    url_index = 0
    while True:
        url = TEST_URLS[url_index % len(TEST_URLS)]
        download_file(url)
        url_index += 1
        
        # 间隔 5 秒后继续下载
        print(f"[下载] 等待 5 秒后继续...", flush=True)
        time.sleep(5)

if __name__ == "__main__":
    main()
