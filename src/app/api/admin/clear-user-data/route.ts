import { NextResponse } from 'next/server';
import { queryOne, query, execute } from '@/lib/supabase-client';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, clearType } = body; // clearType: 'quota' | 'balance'

    if (!userId || !clearType) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    // 获取用户信息
    const user = await queryOne(
      'SELECT id, username, role, balance, provider_id, branch_id FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    if (clearType === 'balance') {
      // 清除收益：balance清零
      await execute(
        'UPDATE users SET balance = 0, updated_at = NOW() WHERE id = $1',
        [userId]
      );
      return NextResponse.json({
        success: true,
        message: `已清除用户 ${user.username} 的收益（原余额：${user.balance}）`
      });
    }

    if (clearType === 'quota') {
      if (user.role === 'member') {
        // 会员清除产品额度：销毁持有的产品，算力额度回到服务商
        // 1. 获取会员持有的所有产品
        const holdingsList = await query(
          `SELECT up.id as up_id, up.product_id, up.purchase_price, p.provider_id
           FROM user_products up
           JOIN products p ON up.product_id = p.id
           WHERE up.user_id = $1 AND up.status = 'holding'`,
          [userId]
        );

        if (!holdingsList || holdingsList.length === 0) {
          return NextResponse.json({ success: true, message: '该会员没有持有的产品，无需清除' });
        }

        // 2. 按服务商分组计算要归还的额度
        const providerRefunds: Record<string, number> = {};
        for (const h of holdingsList) {
          const pid = h.provider_id;
          providerRefunds[pid] = (providerRefunds[pid] || 0) + Number(h.purchase_price);
        }

        // 3. 销毁会员的产品（状态改为cancelled）
        await execute(
          `UPDATE user_products SET status = 'cancelled', updated_at = NOW() WHERE user_id = $1 AND status = 'holding'`,
          [userId]
        );

        // 4. 将产品状态改为available（回到服务商代售）
        await execute(
          `UPDATE products SET status = 'available', updated_at = NOW()
           WHERE id IN (SELECT product_id FROM user_products WHERE user_id = $1 AND status = 'cancelled')`,
          [userId]
        );

        // 5. 将算力额度归还给服务商（providers表没有available_quota列，用quota增加）
        for (const [providerId, amount] of Object.entries(providerRefunds)) {
          await execute(
            `UPDATE providers SET used_quota = GREATEST(used_quota - $1, 0), updated_at = NOW() WHERE user_id = $2`,
            [amount, providerId]
          );
        }

        return NextResponse.json({
          success: true,
          message: `已清除会员 ${user.username} 的产品额度，销毁 ${holdingsList.length} 个产品，算力额度已归还服务商`
        });

      } else if (user.role === 'provider') {
        // 服务商清除算力额度：额度回到网点可分配额度
        const provider = await queryOne(
          'SELECT user_id, quota, used_quota, branch_id FROM providers WHERE user_id = $1',
          [userId]
        );

        if (!provider) {
          return NextResponse.json({ error: '服务商记录不存在' }, { status: 404 });
        }

        // 可清除额度 = quota - used_quota（闲置额度）
        const returnAmount = Number(provider.quota) - Number(provider.used_quota) || 0;

        if (returnAmount <= 0) {
          return NextResponse.json({ success: true, message: '该服务商没有可清除的闲置算力额度' });
        }

        // 1. 将服务商quota设为used_quota（清零闲置额度，保留已用额度）
        await execute(
          `UPDATE providers SET quota = used_quota, updated_at = NOW() WHERE user_id = $1`,
          [userId]
        );

        // 2. 将额度归还到网点的可分配额度
        const allocation = await queryOne(
          `SELECT id, quota_amount, used_amount FROM quota_allocations
           WHERE branch_id = $1 AND provider_id = $2 AND status = 'active'
           ORDER BY created_at DESC LIMIT 1`,
          [provider.branch_id, userId]
        );

        if (allocation) {
          // 更新已有分配记录：减少used_amount（因为服务商释放了额度）
          await execute(
            `UPDATE quota_allocations SET used_amount = GREATEST(used_amount - $1, 0), updated_at = NOW()
             WHERE id = $2`,
            [returnAmount, allocation.id]
          );
        }

        return NextResponse.json({
          success: true,
          message: `已清除服务商 ${user.username} 的闲置算力额度 ${returnAmount}，已归还到网点可分配额度`
        });

      } else {
        return NextResponse.json({ error: '该角色不支持清除产品额度' }, { status: 400 });
      }
    }

    return NextResponse.json({ error: '无效的清除类型' }, { status: 400 });
  } catch (error) {
    console.error('[clear-user-data] error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
