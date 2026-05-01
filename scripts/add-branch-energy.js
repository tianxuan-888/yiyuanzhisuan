#!/usr/bin/env node
/**
 * 给分公司充能量值的脚本
 */

const http = require('http');

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('1. 登录获取 token...');
  const login = await post('/api/auth/login', {
    loginKey: 'admin',
    password: 'admin123'
  });
  
  if (!login.success) {
    console.error('登录失败:', login.error);
    return;
  }
  
  const token = login.data?.token;
  console.log('登录成功');

  console.log('\n2. 给分公司分配额度...');
  const result = await post('/api/admin/allocate-branch', {
    adminId: '00000000-0000-0000-0000-000000000001',
    branchId: '00000000-0000-0000-0000-000000000011',
    amount: 50000,
    note: '测试分配'
  });
  
  console.log('结果:', result);
  
  if (result.success) {
    console.log('\n成功！分公司应获得 50000 额度 + 10000 能量值');
  } else {
    console.log('失败:', result.error);
  }
}

main().catch(console.error);
