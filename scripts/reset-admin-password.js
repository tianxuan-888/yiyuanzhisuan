#!/usr/bin/env node
/**
 * 重置admin密码为admin123的脚本
 */

const http = require('http');

function post(path, data, token = null) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'POST',
      headers
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          resolve({ raw: d });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('重置admin密码...');
  
  const result = await post('/api/admin/reset-password', {
    userId: '00000000-0000-0000-0000-000000000001',
    newPassword: 'admin123'
  });
  
  console.log('结果:', result);
}

main().catch(console.error);
