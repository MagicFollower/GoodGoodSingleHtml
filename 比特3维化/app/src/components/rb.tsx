// ReactBits 适配层：所有 vendored 组件只在这里被引用。
//
// 这样做的两个理由：
// 1. props 形状变了只需改一处（件是 vendored 的，不能改它们的源码，lock.json 会红）；
// 2. 件里有一批颜色 props 走 JS 解析（只认 #hex / rgb()），全部在这里从 CSS 令牌解析成真色。

import type { ReactNode } from 'react';

import DarkVeil from '../reactbits/DarkVeil';
import LineSidebar from '../reactbits/LineSidebar';
import SpotlightCard from '../reactbits/SpotlightCard';
import BorderGlow from '../reactbits/BorderGlow';
import GlassIcons from '../reactbits/GlassIcons';
import SplitText from '../reactbits/SplitText';
import GradientText from '../reactbits/GradientText';
import ShinyText from '../reactbits/ShinyText';
import DecryptedText from '../reactbits/DecryptedText';
import JellyRadio from '../reactbits/JellyRadio';
import SquishSwitch from '../reactbits/SquishSwitch';
import GlideSelect from '../reactbits/GlideSelect';
import CurvedInput from '../reactbits/CurvedInput';
import HoldButton from '../reactbits/HoldButton';
import SpecularButton from '../reactbits/SpecularButton';
import StarBorder from '../reactbits/StarBorder';
import CometDial from '../reactbits/CometDial';
import LatticeLoader from '../reactbits/LatticeLoader';
import StatusMark from '../reactbits/StatusMark';
import Counter from '../reactbits/Counter';
import AnimatedList from '../reactbits/AnimatedList';
import FadeContent from '../reactbits/FadeContent';
import WarmTooltip from '../reactbits/WarmTooltip';

export type Colors = {
  bg: string; surface: string; surface2: string; ink: string; ink2: string; ink3: string; line: string;
  accent: string; accentInk: string; accentSoft: string; ok: string; warn: string; err: string; run: string;
};

export type Dark = boolean;

export function Veil({ c, motionOk }: { c: Colors; motionOk: boolean }) {
  return (
    <div className="bg-veil" aria-hidden="true">
      <DarkVeil color={c.accent} brightness={0.5} flow={0.9} glow={0.25} grain={0.16} speed={0.7}
        mouseInteraction={false} paused={!motionOk} intro={false} dpr={1} quality={0.4} />
      {/* dpr 1.25 时这块全屏画布是 1580×944（实测 canvas=dark-veil-canvas [0,0 1264x755] 1580x944），
          是整窗最大的一块 GPU 面；噪声场按 quality 0.4 采样已经看不出差别，没必要为它多要 60% 的像素。 */}
    </div>
  );
}

export function Nav({ items, active, onSelect, c }: { items: string[]; active: number; onSelect: (i: number) => void; c: Colors }) {
  return (
    <div className="side-nav">
      <LineSidebar items={items} defaultActive={active}
        onItemClick={(i) => onSelect(i)}
        accentColor={c.accent} textColor={c.ink3} markerColor={c.line}
        showIndex={false} showMarker={true} markerLength={26} markerGap={5} maxShift={7}
        itemGap={14} fontSize={0.95} proximityRadius={90} falloff="smooth" />
        {/* fontSize 的单位是 rem（件里写 '--font-size': `${fontSize}rem`），传 15 就是 15rem 的巨字 */}
    </div>
  );
}

export function Panel({ title, hint, children, c, dense }: { title?: ReactNode; hint?: ReactNode; children: ReactNode; c: Colors; dense?: boolean }) {
  return (
    <div className={dense ? 'panel panel--dense' : 'panel'} style={{ borderColor: c.line, background: c.surface }}>
      {title && (
        <div className="panel__title">
          <span className="panel__title-text">{title}</span>
          {hint && <span className="panel__hint">{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** GradientText 留给大字号的装饰位（面板小标题上用会显出重影，实测截图里标题发虚）。 */
export function AccentText({ children, c }: { children: ReactNode; c: Colors }) {
  return (
    <GradientText colors={[c.accent, c.ink, c.accent]} animationSpeed={5} variant="flow" angle={12}
      glow={0} showBorder={false} pauseOnHover={true}>
      {children}
    </GradientText>
  );
}

export function StatCard({ children, c, dark }: { children: ReactNode; c: Colors; dark: Dark }) {
  return (
    <SpotlightCard theme={dark ? 'dark' : 'light'} spotlightColor={`${c.accent}44`} intensity={0.55}
      spotlightSize={280} softness={0.55} shape="circle" borderGlow={0.3} ambient={false} grain={0}>
      <div className="panel" style={{ padding: 12 }}>{children}</div>
    </SpotlightCard>
  );
}

export function DropFrame({ over, children, c }: { over: boolean; children: ReactNode; c: Colors }) {
  return (
    <BorderGlow className="border-glow-host" borderRadius={14} animated={over} glowColor={c.accent}
      backgroundColor={c.surface2} glowRadius={over ? 46 : 24} glowIntensity={over ? 0.6 : 0.22}
      coneSpread={24} fillOpacity={over ? 0.24 : 0.08} edgeSensitivity={8}>
      {children}
    </BorderGlow>
  );
}

export function FileGlyphs({ items, dark }: { items: { icon: ReactNode; label?: string; color?: string }[]; dark: Dark }) {
  return (
    <div className="file-glyphs">
      <GlassIcons items={items} size={44} gap={10} columns={Math.min(items.length, 8)} roundness={0.42}
        refraction={0.6} bevel={0.5} dispersion={0.4} frost={0.3} shine={0.55} tintOpacity={0.35}
        plate="offset" tilt={7} hover="lift" parallax={0.4} labels="hover" intro={false} theme={dark ? 'dark' : 'light'} />
    </div>
  );
}

export function AppTitle({ text, c, replayKey }: { text: string; c: Colors; replayKey: string }) {
  return (
    <SplitText key={replayKey} text={text} tag="h1" className="topbar__title" trigger="load" splitType="chars"
      effect="rise" duration={0.5} delay={0} staggerFrom="start" color={c.ink} accentColor={c.accent} mask={false} />
  );
}

export function Badge({ text, c }: { text: string; c: Colors }) {
  return <ShinyText text={text} color={c.ink3} shineColor={c.accent} speed={3.5} angle={18} glow={0} disabled={false} />;
}

export function StatusLine({ text, c, dark }: { text: string; c: Colors; dark: Dark }) {
  return (
    <DecryptedText key={text} text={text} speed={34} maxIterations={2} sequential revealDirection="start"
      effect="scramble" scrambleColor={c.accent} animateOn="view" className={dark ? 'rb-ink' : 'rb-ink'} />
  );
}

export function ModeSwitch({ value, onChange, options, c }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; c: Colors }) {
  return (
    <JellyRadio items={options} value={value} onChange={(v) => onChange(v)} size="sm" gap={6} radius={999}
      chipColor={c.surface2} activeColor={c.accent} textColor={c.ink2} activeTextColor={c.accentInk}
      swell={1.06} barge={0.12} shrink={0.94} jelly={0.9} bounce={0.22} ariaLabel="模式" />
  );
}

export function Toggle({ checked, onChange, label, c }: { checked: boolean; onChange: (v: boolean) => void; label: string; c: Colors }) {
  return (
    <SquishSwitch checked={checked} onChange={onChange} label={label} ariaLabel={label}
      trackColor={c.surface2} trackOnColor={c.accent} thumbColor={c.ink3} thumbOnColor={c.accentInk}
      width={46} height={24} radius={999} stretch={1.16} hoverScale={1.05} />
  );
}

export function Select({ options, value, onChange, placeholder, c, wide }: { options: { value: string; label: string; tag?: string }[]; value: string; onChange: (v: string) => void; placeholder?: string; c: Colors; wide?: boolean }) {
  return (
    <div className="glide-host">
      <GlideSelect options={options} value={value} onChange={(v) => onChange(v)} placeholder={placeholder}
        size="sm" radius={10} accentColor={c.accent} surfaceColor={c.surface2} highlightColor={c.accentSoft}
        textColor={c.ink} showTags={false} menuWidth={wide ? 260 : undefined} ariaLabel={placeholder} />
    </div>
  );
}

export function PathInput({ value, onChange, onCommit, placeholder, button = '选择', c, dark, showButton = true }: {
  value: string; onChange: (v: string) => void; onCommit?: (v: string) => void; placeholder: string; button?: string;
  c: Colors; dark: Dark; showButton?: boolean;
}) {
  return (
    <CurvedInput value={value} onChange={onChange} onSubmit={onCommit ? (v) => onCommit(v) : undefined}
      placeholder={placeholder} buttonText={button} showButton={showButton} showIcon={false}
      theme={dark ? 'dark' : 'light'} width="100%" height={44} bend={9} cornerRadius={12} borderWidth={1.5}
      fontSize={13} backgroundColor={c.surface2} textColor={c.ink} placeholderColor={c.ink3}
      borderColor={c.line} buttonColor={c.accent} buttonTextColor={c.accentInk} shadowSize="sm" />
  );
}

export function Execute({ onHold, disabled, c, label = '按住执行', done = '已提交' }: { onHold: () => void; disabled: boolean; c: Colors; label?: string; done?: string }) {
  return (
    <div className="cta-frame">
      <StarBorder color={c.accent} trailColor={c.accentSoft} thickness={1.4} radius={12} trailLength={0.42}
        stars={14} glow={0.5} sparkle={true} hover="brighten" clickPulse={false} theme="dark"
        backgroundColor={c.surface} textColor={c.ink}>
        <div className="hold-target fit-inner">
          <HoldButton children={label} doneLabel={done} onHold={onHold} holdTime={520} releaseTime={260}
            resetAfter={1200} pressScale={0.975} fillDirection="right" wave={true} waveAmplitude={4} glow={true}
            size="lg" radius={13} backgroundColor={c.accent} fillColor={c.accentInk} textColor={c.accentInk}
            fillTextColor={c.accent} disabled={disabled} />
        </div>
      </StarBorder>
    </div>
  );
}

export function GhostButton({ children, onClick, disabled, c, title }: { children: ReactNode; onClick: () => void; disabled?: boolean; c: Colors; title?: string }) {
  const btn = (
    <SpecularButton onClick={onClick} disabled={disabled} size="sm" radius={10} type="button"
      tint={c.accent} tintOpacity={0.5} blur={9} textColor={c.ink} lineColor={c.line} baseColor={c.surface2}
      intensity={1.1} idleIntensity={0.4} thickness={1.2} glow={0.35} speed={0.35} followMouse={true} proximity={120} autoAnimate={false}>
      {children}
    </SpecularButton>
  );
  return title ? <Tip content={title}>{btn}</Tip> : btn;
}

/**
 * 「打开输出目录」用 SpecularButton 而不是 FlyingButton。
 * 实测（--probe，1440×880 窗口）FlyingButton 的根盒是 div.flying-button [90,744 1408×240]，
 * 横穿整个底栏并挡在 footer.statusbar 之上 —— elementsFromPoint 第一个命中就是它，
 * 也就是它会吞掉那一条区域内的点击。件本身的动画没问题，但它假定自己在一个确定尺寸的容器里。
 */
export function FolderButton({ onClick, c, children = '打开输出目录' }: { onClick: () => void; c: Colors; children?: ReactNode }) {
  return (
    <SpecularButton onClick={onClick} size="sm" radius={10} type="button"
      tint={c.ok} tintOpacity={0.55} blur={7} textColor={c.ink} lineColor={c.line} baseColor={c.surface2}
      intensity={0.9} idleIntensity={0.3} thickness={1.1} glow={0.25} speed={0.3} followMouse={true} proximity={110} autoAnimate={false}>
      {children}
    </SpecularButton>
  );
}

export function Dial({ pct, label, c }: { pct: number; label: string; c: Colors }) {
  return (
    <CometDial value={Math.max(0, Math.min(100, Math.round(pct)))} min={0} max={100} unit="%" label={label}
      accent={c.accent} ink={c.ink} size={132} sweep={300} thickness={9} speed={0.6} tapBounce={0} flickBounce={0}
      momentum={0} cometReach={0.9} cometWidth={1.6} disabled={true} />
  );
}

export function Busy({ status, elapsed, c }: { status: 'working' | 'done' | 'error'; elapsed: number; c: Colors }) {
  return (
    <LatticeLoader status={status} pattern="sweep" grid={4} shape="round" cellSize={8} gap={4}
      color={c.accent} doneColor={c.ok} errorColor={c.err} label="处理中" doneLabel="完成" errorLabel="失败"
      fontSize={11} idleOpacity={0.18} glow={true} glowColor={c.accent} showTimer={true} elapsed={elapsed} />
  );
}

export function Dot({ status, c }: { status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'; c: Colors }) {
  return (
    <StatusMark status={status} size={22} strokeWidth={2} color={c.ink3} doneColor={c.ok} errorColor={c.err}
      spinDuration={900} arcLength={0.72} drawDuration={260} fillOpacity={0.12} strike={false} dashes={1} />
  );
}

export function Stat({ value, suffix, c }: { value: number; suffix?: string; c: Colors }) {
  return (
    <Counter value={value} decimals={0} tabular={true} duration={520} direction="up" motionBlur={false}
      intro={true} fade={0} textColor={c.ink} fontSize={'1.15rem'} fontWeight={650} suffix={suffix} />
  );
}

export function Queue({ items, selected, onSelect, renderItem, c, dark, height }: {
  items: { id: string; title: ReactNode; description?: ReactNode; meta?: ReactNode }[];
  selected: string | null;
  onSelect: (id: string) => void;
  renderItem: (item: unknown, index: number, isSelected: boolean) => ReactNode;
  c: Colors; dark: Dark; height: number | string;
}) {
  return (
    <div className="job-list">
      <AnimatedList
        items={items.map((i) => ({ id: i.id, title: i.title, description: i.description, meta: i.meta }))}
        renderItem={(item, index, isSelected) => renderItem(item, index, isSelected)}
        onItemSelect={(_item, index) => onSelect(String(items[index]?.id ?? ''))}
        initialSelectedIndex={selected ? Math.max(0, items.findIndex((i) => i.id === selected)) : 0}
        selectOnHover={false} enableArrowNavigation={true} animation="fade" animateOnce={false}
        showGradients={false} displayScrollbar={true} frame={false} theme={dark ? 'dark' : 'light'}
        accentColor={c.accent} radius={10} gap={6} width="100%" maxHeight={height}
        itemClassName="job" />
    </div>
  );
}

export function Fade({ children, replayKey }: { children: ReactNode; replayKey: string }) {
  return (
    <FadeContent key={replayKey} trigger="mount" effect="fade" blur={false} duration={0.32} delay={0}
      threshold={0} initialOpacity={0} once={true} className="view-stack">
      {children}
    </FadeContent>
  );
}

export function Tip({ content, shortcut, children }: { content: ReactNode; shortcut?: ReactNode; children: ReactElementish }) {
  return (
    <span className="tip-host">
      <WarmTooltip content={content} shortcut={shortcut} side="top" delay={160} warmWindow={600}
        size="sm" radius={10} gap={8} arrow={true} popDuration={180}>
        {children}
      </WarmTooltip>
    </span>
  );
}

// WarmTooltip 要求 children 是 ReactElement（且带可注入的 props），这里只在本工程内收窄类型。
type ReactElementish = Parameters<typeof WarmTooltip>[0]['children'];
