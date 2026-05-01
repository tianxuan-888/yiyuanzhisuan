const { Pool } = require('pg');

// 使用 Supabase PostgreSQL 连接
const pool = new Pool({
  connectionString: process.env.PGDATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function updateMemberRelations() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 查看现有用户
    const existingUsers = await client.query(`SELECT id, username, phone, role, provider_id, inviter_id, branch_id FROM users`);
    console.log('现有用户:');
    existingUsers.rows.forEach(u => {
      console.log(`  ${u.username} (${u.phone}) - ${u.role} - provider: ${u.provider_id || '无'} - branch: ${u.branch_id || '无'}`);
    });

    // 查找服务商 (phone = '13800000021') - 角色必须是provider
    const providerResult = await client.query(`SELECT id, username FROM users WHERE phone = '13800000021' AND role = 'provider'`);
    
    if (providerResult.rows.length === 0) {
      console.log('\n未找到服务商 (phone: 13800000021, role: provider)');
      await client.query('ROLLBACK');
      return;
    }
    
    const providerId = providerResult.rows[0].id;
    console.log('\n找到服务商:', providerResult.rows[0].username, '- ID:', providerId);

    // 检查服务商在providers表中的配置
    const provConfigResult = await client.query(`SELECT id, quota FROM providers WHERE user_id = $1`, [providerId]);
    if (provConfigResult.rows.length === 0) {
      // 需要创建服务商配置
      const newProvId = 'prov-' + providerId.slice(0, 8);
      await client.query(`
        INSERT INTO providers (id, user_id, quota, used_quota, branch_id, total_sales, created_at)
        VALUES ($1, $2, 50000, 0, '00000000-0000-0000-0000-000000000011', 0, NOW())
      `, [newProvId, providerId]);
      console.log('已创建服务商配置, quota=50000');
    } else {
      console.log('服务商配置已存在, quota:', provConfigResult.rows[0].quota);
    }

    // 查找并更新会员 (phone = '13866666666')
    const memberResult = await client.query(`SELECT id, username, provider_id FROM users WHERE phone = '13866666666'`);
    
    if (memberResult.rows.length > 0) {
      const memberId = memberResult.rows[0].id;
      const oldProviderId = memberResult.rows[0].provider_id;
      
      await client.query(`
        UPDATE users SET 
          provider_id = $1, 
          inviter_id = $1, 
          branch_id = '00000000-0000-0000-0000-000000000011'
        WHERE id = $2
      `, [providerId, memberId]);
      
      console.log('\n已更新会员:', memberResult.rows[0].username);
      console.log('  旧服务商ID:', oldProviderId || '无');
      console.log('  新服务商ID:', providerId);
    }

    await client.query('COMMIT');
    console.log('\n✅ 用户关系更新完成!');
    console.log('\n当前关系:');
    console.log('  member1 (13866666666) -> provider1 (13800000021) -> branch1 (13800000011)');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('更新失败:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

updateMemberRelations();
