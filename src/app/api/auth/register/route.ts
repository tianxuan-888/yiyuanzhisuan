import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword } from '@/lib/password';
import { getInviteCodeType, generateUniqueId, findUserByInviteCode } from '@/lib/invite-code';
import { getVerifyCode, deleteVerifyCode } from '@/lib/verify-code';
import { checkSmsVerifyCode, isAliyunSmsConfigured } from '@/lib/aliyun-sms';

// 用户注册接口
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, phone, realName, alipayAccount, invite_code, verify_code } = body;

    // 参数验证
    if (!username || !password) {
      return NextResponse.json(
        { error: '用户名和密码不能为空' },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 50) {
      return NextResponse.json(
        { error: '用户名长度必须在 3-50 个字符之间' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码长度不能少于 6 个字符' },
        { status: 400 }
      );
    }

    // 邀请码验证（必填）
    if (!invite_code) {
      return NextResponse.json(
        { error: '请填写邀请码' },
        { status: 400 }
      );
    }

    // 手机号验证（必填）
    if (!phone) {
      return NextResponse.json(
        { error: '请填写手机号' },
        { status: 400 }
      );
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return NextResponse.json(
        { error: '请输入正确的手机号' },
        { status: 400 }
      );
    }

    // 验证码验证（必填）
    if (!verify_code) {
      return NextResponse.json(
        { error: '请填写验证码' },
        { status: 400 }
      );
    }

    // 验证验证码：优先使用阿里云服务端校验，否则本地数据库比对
    if (isAliyunSmsConfigured()) {
      const checkResult = await checkSmsVerifyCode(phone, verify_code);
      if (!checkResult.success) {
        return NextResponse.json(
          { error: checkResult.message || '验证码错误' },
          { status: 400 }
        );
      }
    } else {
      const storedCode = await getVerifyCode(phone);
      if (!storedCode || storedCode.code !== verify_code) {
        return NextResponse.json(
          { error: '验证码错误或已过期' },
          { status: 400 }
        );
      }
      if (storedCode.expiresAt < Date.now()) {
        await deleteVerifyCode(phone);
        return NextResponse.json(
          { error: '验证码已过期，请重新获取' },
          { status: 400 }
        );
      }
    }

    // 检查用户名是否已存在（直接使用 Supabase REST API，避免 rpc_query 不稳定）
    const supabase = getSupabase();
    const { data: existingUsers } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .limit(1);

    if (existingUsers && existingUsers.length > 0) {
      return NextResponse.json(
        { error: '用户名已存在' },
        { status: 400 }
      );
    }

    // 检查手机号是否已注册
    const { data: existingPhone } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .limit(1);

    if (existingPhone && existingPhone.length > 0) {
      return NextResponse.json(
        { error: '该手机号已注册' },
        { status: 400 }
      );
    }

    // 根据邀请码类型处理
    const inviteCodeType = getInviteCodeType(invite_code);
    
    let providerId: string | null = null;
    let branchId: string | null = null;
    let inviterId: string | null = null;
    let inviterInfo: { id: string; username: string } | null = null;
    let assignedRole: string = 'member'; // 默认注册为会员

    if (inviteCodeType === 'invalid') {
      return NextResponse.json(
        { error: '邀请码无效，请检查后重新输入' },
        { status: 400 }
      );
    }

    // 查找邀请人（通过 unique_id 查找，因为邀请码=唯一ID）
    const inviter = await findUserByInviteCode(invite_code);
    
    if (!inviter) {
      return NextResponse.json(
        { error: '邀请码不存在，请检查后重新输入' },
        { status: 400 }
      );
    }

    inviterInfo = { id: inviter.id, username: inviter.username };

    if (inviteCodeType === 'admin') {
      // 智算中心邀请码：注册为服务网点
      assignedRole = 'branch';
      branchId = null; // 注册后由系统分配 branch_id
      inviterId = inviter.id;
    } else if (inviteCodeType === 'branch') {
      // 服务网点邀请码：注册为服务商
      assignedRole = 'provider';
      branchId = inviter.id; // 服务网点的ID就是branch_id
      inviterId = inviter.id;
    } else if (inviteCodeType === 'provider') {
      // 服务商邀请：注册为会员
      assignedRole = 'member';
      providerId = inviter.id;
      branchId = inviter.branch_id;
      inviterId = inviter.id;
    } else if (inviteCodeType === 'member') {
      // 会员邀请：注册为会员
      assignedRole = 'member';
      providerId = inviter.provider_id;
      branchId = inviter.branch_id;
      inviterId = inviter.id;
      
      if (!providerId) {
        return NextResponse.json(
          { error: '邀请人不属于任何服务商，无法邀请新会员' },
          { status: 400 }
        );
      }
    }

    // 对密码进行哈希
    const hashedPassword = await hashPassword(password);

    // 生成唯一ID（= 邀请码）：2字母角色前缀 + 5位数字
    const uniqueId = await generateUniqueId(assignedRole);
    // 邀请码 = 唯一ID
    const newInviteCode = uniqueId;

    // 创建用户
    const newUsers = await query(
      `INSERT INTO users (username, password, role, phone, real_name, alipay_account, provider_id, branch_id, inviter_id, balance, is_active, unique_id, invite_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, true, $10, $11)
       RETURNING *`,
      [username, hashedPassword, assignedRole, phone, realName || null, alipayAccount || null, providerId, branchId, inviterId, uniqueId, newInviteCode]
    );

    if (newUsers.length === 0) {
      throw new Error('创建用户失败');
    }

    const newUser = newUsers[0];

    // 注册后处理：服务网点设置 branch_id 为自身；服务商创建 providers 记录
    if (assignedRole === 'branch') {
      // 服务网点的 branch_id 指向自己
      await query('UPDATE users SET branch_id = $1 WHERE id = $2', [newUser.id, newUser.id]);
    } else if (assignedRole === 'provider') {
      // 服务商：在 providers 表创建记录
      const targetBranchId = branchId || inviter.id;
      await query(
        'UPDATE users SET branch_id = $1 WHERE id = $2',
        [targetBranchId, newUser.id]
      );
      const existingProvider = await query('SELECT id FROM providers WHERE user_id = $1', [newUser.id]);
      if (existingProvider.length === 0) {
        await query(
          `INSERT INTO providers (user_id, quota, used_quota, total_sales, branch_id) VALUES ($1, 0, 0, 0, $2)`,
          [newUser.id, targetBranchId]
        );
      }
    }

    // 验证成功后删除验证码
    await deleteVerifyCode(phone);

    // 返回用户信息（不包含密码）
    const { password: _, ...userWithoutPassword } = newUser;

    const inviteCodeTypeLabels: Record<string, string> = {
      admin: '智算中心邀请（注册为服务网点）',
      branch: '服务网点邀请（注册为服务商）',
      provider: '服务商邀请',
      member: '会员邀请',
    };

    return NextResponse.json({
      success: true,
      data: {
        user: {
          ...userWithoutPassword,
          invite_code: newInviteCode,
          unique_id: uniqueId,
        },
        inviter: inviterInfo,
        inviteType: inviteCodeTypeLabels[inviteCodeType] || '邀请注册',
        assignedRole,
      },
    });
  } catch (error) {
    console.error('注册失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '注册失败' },
      { status: 500 }
    );
  }
}
