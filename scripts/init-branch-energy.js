#!/usr/bin/env node
/**
 * 使用手机号登录并给分公司充能量值
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
  console.log('=== 步骤1: 使用手机号登录总公司 ===\n');
  const login = await post('/api/auth/login', {
    loginKey: '13800000001',
    password: 'admin123',
    role: 'admin'
  });
  console.log('登录结果:', login);
  
  if (!login.success) {
    console.log('\n登录失败，尝试用用户名登录...');
    
    // 尝试用 username
    const login2 = await post('/api/auth/login', {
      loginKey: 'admin',
      password: 'admin123',
      role: 'admin'
    });
    console.log('用户名登录结果:', login2);
    
    if (!login2.success) {
      console.log('\n登录失败，错误:', login2.error);
      return;
    }
    
    var token = login2.data?.token;
  } else {
    var token = login.data?.token;
  }
  
  console.log('\n获取到token:', token ? '成功' : '失败');
  if (!token) return;

  console.log('\n=== 步骤2: 给分公司分配额度 ===\n');
  const allocateResult = await post('/api/admin/allocate-branch', {
    adminId: '00000000-0000-0000-0000-000000000001',
    branchId: '00000000-0000-0000-0000-000000000011',
    amount: 50000,
    note: '测试分配额度并赠送能量值'
  }, token);
  console.log('分配结果:', allocateResult);
  
  if (allocateResult.success) {
    console.log('\n✓ 成功！分公司应获得:');
    console.log('  - 50000 额度');
    console.log('  - 10000 能量值 (额度的20%)');
  } else {
    console.log('\n错误:', allocateResult.error);
  }
}

main().catch(console.error);
