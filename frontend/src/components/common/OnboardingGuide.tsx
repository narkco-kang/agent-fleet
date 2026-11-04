import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';

/**
 * 新手引导：把 AgentFleet 解释为「多蜂群协同系统」，并串起 EchoBird 式
 * Model Nexus → 一键部署 → 平台模型绑定 → 免费源/Provider → 任务调度流程。
 */

const STORAGE_KEY = 'agentfleet.onboarding.dismissed.v2';

const STEPS = [
  {
    title: '理解系统：设备即蜂群',
    body: '每台设备是一支本地蜂群：设备守护负责探测这台机器上的 Codex、Claude、Gemini、Aider 等 agent 平台；整个 AgentFleet 则是多设备、多蜂群协同系统。',
  },
  {
    title: '先启动协调器组件',
    body: '在「部署」页编译并启动内置 modelgateway。它是所有蜂群共享的智能模型路由网关，提供 OpenAI 兼容接口、免费源兜底和付费 Provider 路由。',
  },
  {
    title: '配置模型源',
    body: '在「路由网关」页完成免费源探测/签到，并在「付费 Provider」里批量配置 OpenAI、DeepSeek、自建 Router 等模型源。',
  },
  {
    title: '部署即用',
    body: '在「部署」页上传 Excel/JSON，填写 deviceId、platforms、models。部署成功后会自动把设备 agent 平台绑定到网关模型。',
  },
  {
    title: '登录激活平台',
    body: '在首页神经图中点击某个 agent 神经元（圆角方块），右侧详情里点「打开平台应用登录激活」，设备会弹出对应平台应用，完成登录后该平台即被激活、可用于派发任务。',
  },
  {
    title: '观察与切换',
    body: '在「平台模型」页查看每个设备 agent 的主模型、兜底模型和当前生效模型。模型失败会自动切换，必要时也可以手动切换或重置。',
  },
];

export function OnboardingGuide({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  if (!open) return null;

  const close = (): void => {
    localStorage.setItem(STORAGE_KEY, '1');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-[var(--surface)] shadow-2xl">
        <div className="border-b border-[var(--border)] px-6 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-[#4F46E5]">AgentFleet 新手引导</div>
          <h2 className="mt-1 text-xl font-semibold text-[var(--text-strong)]">{current.title}</h2>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm leading-7 text-[var(--text)]">{current.body}</p>
          <div className="mt-5 grid grid-cols-5 gap-2">
            {STEPS.map((s, idx) => (
              <button
                key={s.title}
                onClick={() => setStep(idx)}
                className={`h-1.5 rounded-full ${idx === step ? 'bg-[#4F46E5]' : 'bg-[#E2E8F0]'}`}
                aria-label={`切换到第 ${idx + 1} 步`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4">
          <Button size="small" color="inherit" onClick={close}>
            不再自动显示
          </Button>
          <div className="flex gap-2">
            <Button size="small" color="inherit" onClick={() => setStep((v) => Math.max(0, v - 1))} disabled={step === 0}>
              上一步
            </Button>
            {step < STEPS.length - 1 ? (
              <Button size="small" variant="contained" onClick={() => setStep((v) => Math.min(STEPS.length - 1, v + 1))}>
                下一步
              </Button>
            ) : (
              <Button size="small" variant="contained" onClick={close}>
                开始使用
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function useOnboardingState(): { open: boolean; show: () => void; close: () => void } {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) !== '1') setOpen(true);
  }, []);
  return {
    open,
    show: () => setOpen(true),
    close: () => setOpen(false),
  };
}
