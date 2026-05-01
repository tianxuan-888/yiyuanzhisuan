// ============================================
// 华能智算 - GPU算力产品配置
// ============================================
// 
// 【产品分级】
// 蓝色系 - 入门级：英伟达 RTX 系列
// 绿色系 - 进阶级：华为昇腾系列
// 橙黄色系 - 高端级：思元系列
//
// 【公司型号】
// 英伟达 NVIDIA: RTX 4090, RTX 3090, A100, H100
// 华为 Huawei: 昇腾 910B, 昇腾 910, 昇腾 310
// 思元 Sugon: MLU290, MLU270, MLU220
//
// ============================================

// 产品等级
export type ProductLevel = 'entry' | 'advanced' | 'premium';

// GPU公司类型
export type GPUVendor = 'nvidia' | 'huawei' | 'sugon';

// GPU型号接口
export interface GPUModel {
  id: string;
  vendor: GPUVendor;
  name: string;
  fullName: string; // 完整名称如 "NVIDIA RTX 4090"
  level: ProductLevel;
  description: string;
  specs: string; // 关键参数
  tdp: number; // 功耗W
  memory: string; // 显存
}

// 周期配置
export interface CycleConfig {
  cycle: string;
  name: string;
  days: number;
  totalRate: number;
  memberRate: number;
  energyRate: number;
}

// GPU型号数据
export const gpuModels: GPUModel[] = [
  // ===== 蓝色系 - 入门级 (NVIDIA RTX系列) =====
  {
    id: 'nvidia-rtx4090',
    vendor: 'nvidia',
    name: 'RTX 4090',
    fullName: 'NVIDIA RTX 4090',
    level: 'entry',
    description: '最新一代旗舰游戏显卡，超强AI算力，适合入门级算力租赁',
    specs: '16384 CUDA核心 | 24GB GDDR6X',
    tdp: 450,
    memory: '24GB GDDR6X'
  },
  {
    id: 'nvidia-rtx3090',
    vendor: 'nvidia',
    name: 'RTX 3090',
    fullName: 'NVIDIA RTX 3090',
    level: 'entry',
    description: '旗舰级游戏显卡，强大算力支持，稳定可靠',
    specs: '10496 CUDA核心 | 24GB GDDR6X',
    tdp: 350,
    memory: '24GB GDDR6X'
  },
  {
    id: 'nvidia-a4000',
    vendor: 'nvidia',
    name: 'RTX A4000',
    fullName: 'NVIDIA RTX A4000',
    level: 'entry',
    description: '专业级显卡，均衡性能，性价比之选',
    specs: '6144 CUDA核心 | 16GB GDDR6',
    tdp: 140,
    memory: '16GB GDDR6'
  },
  
  // ===== 绿色系 - 进阶级 (华为昇腾系列) =====
  {
    id: 'huawei-ascend910b',
    vendor: 'huawei',
    name: '昇腾 910B',
    fullName: '华为昇腾 910B',
    level: 'advanced',
    description: '华为旗舰AI芯片，澎湃算力，企业级应用首选',
    specs: '2560 TOPS INT8 | 256GB HBM',
    tdp: 400,
    memory: '256GB HBM'
  },
  {
    id: 'huawei-ascend910',
    vendor: 'huawei',
    name: '昇腾 910',
    fullName: '华为昇腾 910',
    level: 'advanced',
    description: '华为自研AI处理器，算力强劲，生态完善',
    specs: '256 TOPS INT8 | 32GB HBM',
    tdp: 310,
    memory: '32GB HBM'
  },
  {
    id: 'huawei-ascend310',
    vendor: 'huawei',
    name: '昇腾 310',
    fullName: '华为昇腾 310',
    level: 'advanced',
    description: '高能效AI推理芯片，边缘计算理想选择',
    specs: '22 TOPS INT8 | 8GB LPDDR4',
    tdp: 8,
    memory: '8GB LPDDR4'
  },
  
  // ===== 橙黄色系 - 高端级 (思元系列) =====
  {
    id: 'sugon-mlu290',
    vendor: 'sugon',
    name: '思元 290',
    fullName: '思元 MLU290',
    level: 'premium',
    description: '国产高端AI训练芯片，超大规模并行计算能力',
    specs: '512 TOPS FP16 | 128GB HBM2',
    tdp: 350,
    memory: '128GB HBM2'
  },
  {
    id: 'sugon-mlu270',
    vendor: 'sugon',
    name: '思元 270',
    fullName: '思元 MLU270',
    level: 'premium',
    description: '高性能AI推理芯片，支持多种精度计算',
    specs: '128 TOPS INT8 | 32GB HBM',
    tdp: 150,
    memory: '32GB HBM'
  },
  {
    id: 'sugon-mlu220',
    vendor: 'sugon',
    name: '思元 220',
    fullName: '思元 MLU220',
    level: 'premium',
    description: '边缘AI加速卡，低功耗高性能解决方案',
    specs: '16 TOPS INT8 | 4GB LPDDR4',
    tdp: 25,
    memory: '4GB LPDDR4'
  },
];

// 周期配置
export const cycleConfigs: CycleConfig[] = [
  { cycle: '3days', name: '3天短期', days: 3, totalRate: 5, memberRate: 2, energyRate: 3 },
  { cycle: '7days', name: '7天稳健', days: 7, totalRate: 10, memberRate: 5, energyRate: 5 },
  { cycle: '15days', name: '15天中期', days: 15, totalRate: 20, memberRate: 10, energyRate: 10 },
  { cycle: '30days', name: '30天长期', days: 30, totalRate: 44, memberRate: 22, energyRate: 22 },
  { cycle: '90days', name: '90天旗舰', days: 90, totalRate: 120, memberRate: 60, energyRate: 60 },
];

// 等级颜色配置
export const levelColors = {
  entry: {
    primary: 'blue',
    gradient: 'from-blue-500 to-blue-600',
    bgLight: 'bg-blue-50',
    bgDark: 'bg-blue-600',
    textLight: 'text-blue-600',
    textDark: 'text-blue-400',
    border: 'border-blue-300',
    badge: 'bg-blue-100 text-blue-700',
    iconBg: 'bg-blue-500',
  },
  advanced: {
    primary: 'green',
    gradient: 'from-green-500 to-emerald-600',
    bgLight: 'bg-green-50',
    bgDark: 'bg-green-600',
    textLight: 'text-green-600',
    textDark: 'text-green-400',
    border: 'border-green-300',
    badge: 'bg-green-100 text-green-700',
    iconBg: 'bg-green-500',
  },
  premium: {
    primary: 'amber',
    gradient: 'from-amber-500 to-orange-600',
    bgLight: 'bg-amber-50',
    bgDark: 'bg-amber-600',
    textLight: 'text-amber-600',
    textDark: 'text-amber-400',
    border: 'border-amber-300',
    badge: 'bg-amber-100 text-amber-700',
    iconBg: 'bg-amber-500',
  },
};

// 等级名称
export const levelNames = {
  entry: '入门级',
  advanced: '进阶级',
  premium: '高端级',
};

// 公司名称
export const vendorNames = {
  nvidia: '英伟达 NVIDIA',
  huawei: '华为 Huawei',
  sugon: '思元 Sugon',
};

// 公司图标颜色
export const vendorColors = {
  nvidia: 'text-green-600',
  huawei: 'text-red-500',
  sugon: 'text-yellow-600',
};

// 根据产品ID获取GPU型号
export function getGPUModel(productId: string): GPUModel | undefined {
  // 从产品ID解析GPU型号 (格式: gpu-vendor-cycle-price)
  const parts = productId.split('-');
  if (parts.length < 2) return undefined;
  
  const vendor = parts[1] as GPUVendor;
  const modelName = parts.slice(2, -1).join('-');
  
  return gpuModels.find(m => 
    m.vendor === vendor && 
    m.name.toLowerCase().includes(modelName.toLowerCase())
  );
}

// 根据等级获取颜色配置
export function getLevelColor(level: ProductLevel) {
  return levelColors[level];
}

// 根据公司获取GPU型号列表
export function getModelsByVendor(vendor: GPUVendor): GPUModel[] {
  return gpuModels.filter(m => m.vendor === vendor);
}

// 根据等级获取GPU型号列表
export function getModelsByLevel(level: ProductLevel): GPUModel[] {
  return gpuModels.filter(m => m.level === level);
}
