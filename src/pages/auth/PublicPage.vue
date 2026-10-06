<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { serverRequest } from '../../api/session'
const data = ref<unknown>()
const error = ref('')
const busy = ref(false)
async function load() {
  busy.value = true; error.value = ''
  try { data.value = await serverRequest('/public') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '公开内容读取失败' }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <main class="public-page">
    <div class="ambient ambient-one" />
    <div class="ambient ambient-two" />
    <header class="public-nav">
      <div class="brand">
        <span class="brand-mark">✦</span>
        <span>AI CONTENT FACTORY</span>
      </div>
      <router-link class="nav-login" to="/login">登录生产空间 <span>→</span></router-link>
    </header>
    <section class="public-hero">
      <div class="hero-copy">
        <p class="eyebrow">CONTENT PRODUCTION SYSTEM</p>
        <h1>把灵感，<br /><em>变成内容。</em></h1>
        <p class="hero-lead">一个面向团队的 AI 内容生产空间，从选题到交付，让每一步创作都清晰、可控、可追溯。</p>
        <div class="hero-actions">
          <router-link class="primary-action" to="/login">进入生产空间 <span>↗</span></router-link>
          <a href="#capabilities" class="secondary-action">了解更多</a>
        </div>
        <div class="hero-note"><span class="pulse" />安全的团队内容工作区</div>
      </div>
      <div class="hero-visual" aria-label="内容生产流程示意">
        <div class="visual-orbit orbit-one" />
        <div class="visual-orbit orbit-two" />
        <div class="visual-core">
          <span class="core-spark">✦</span>
          <strong>CREATE</strong>
          <small>审核 · 交付</small>
        </div>
        <div class="floating-card card-topic"><span class="card-icon">◌</span><span><b>选题洞察</b><small>从想法开始</small></span></div>
        <div class="floating-card card-video"><span class="card-icon">▶</span><span><b>AI 视频</b><small>视觉化表达</small></span></div>
        <div class="floating-card card-review"><span class="card-icon">✓</span><span><b>质量审核</b><small>放心交付</small></span></div>
      </div>
    </section>
    <section id="capabilities" class="capabilities">
      <div class="section-label"><span>01</span><p>WHY FACTORY</p></div>
      <div class="capability-grid">
        <article><span class="cap-number">01</span><h2>统一生产</h2><p>视频、图文、脚本和素材在同一个工作空间协同完成。</p></article>
        <article><span class="cap-number">02</span><h2>过程可控</h2><p>流水线、质量门和人工审核，让内容从生成走向可靠交付。</p></article>
        <article><span class="cap-number">03</span><h2>资产沉淀</h2><p>每次创作都留下清晰的执行记录和可追溯的内容资产。</p></article>
      </div>
    </section>
    <section class="public-data">
      <div class="data-heading"><span><i />公开信息</span><a-button type="text" :loading="busy" @click="load">刷新</a-button></div>
      <a-alert v-if="error" type="error" :message="error" show-icon />
      <pre v-if="data">{{ JSON.stringify(data, null, 2) }}</pre>
      <p v-else class="data-empty">公开数据加载后会显示在这里。</p>
    </section>
    <footer>© 2026 AI Content Factory <span>为创作而生</span></footer>
  </main>
</template>
<style scoped>
.public-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  padding: 0 clamp(24px, 7vw, 110px);
  color: #f8f7ff;
  background: #080b20 url('/mock-assets/login-hero-background-v1.png') center / cover;
}
.public-page::before { content: ''; position: absolute; inset: 0; background: linear-gradient(110deg, rgba(8,11,32,.98), rgba(15,18,52,.9) 48%, rgba(42,29,85,.72)); }
.public-nav, .public-hero, .capabilities, .public-data, footer { position: relative; z-index: 1; max-width: 1220px; margin: auto; }
.public-nav { display: flex; align-items: center; justify-content: space-between; padding: 28px 0; border-bottom: 1px solid rgba(255,255,255,.1); }
.brand { display: flex; align-items: center; gap: 12px; color: #f6f3ff; font-size: 11px; font-weight: 700; letter-spacing: .16em; }
.brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, #7568f4, #a873df); font-size: 18px; }
.nav-login { color: #d6d1ff; font-size: 13px; text-decoration: none; }
.nav-login span, .hero-actions span { margin-left: 8px; font-size: 18px; }
.public-hero { min-height: 590px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(380px, .9fr); align-items: center; gap: 40px; }
.eyebrow, .section-label p { margin: 0; color: #aaa2ff; font-size: 11px; font-weight: 700; letter-spacing: .2em; }
.hero-copy h1 { margin: 20px 0; font-size: clamp(50px, 7vw, 92px); line-height: .98; letter-spacing: -.08em; }
.hero-copy h1 em { color: #c9c4ff; font-style: normal; }
.hero-lead { max-width: 500px; margin: 0; color: #b8b8cc; font-size: 17px; line-height: 1.8; }
.hero-actions { display: flex; align-items: center; gap: 24px; margin-top: 34px; }
.primary-action { padding: 14px 22px; border-radius: 10px; background: #7568f4; color: white; text-decoration: none; box-shadow: 0 12px 28px rgba(99,91,219,.3); }
.secondary-action { color: #c7c3dd; font-size: 13px; text-decoration: none; border-bottom: 1px solid #777297; padding-bottom: 5px; }
.hero-note { display: flex; align-items: center; gap: 9px; margin-top: 45px; color: #85869f; font-size: 12px; }
.pulse { width: 7px; height: 7px; border-radius: 50%; background: #64d0a0; box-shadow: 0 0 0 5px rgba(100,208,160,.12); }
.hero-visual { position: relative; height: 400px; }
.visual-orbit { position: absolute; inset: 12% 8%; border: 1px solid rgba(160,147,255,.28); border-radius: 50%; transform: rotate(-22deg); }
.orbit-two { inset: 22% 0; transform: rotate(36deg); border-color: rgba(92,205,224,.2); }
.visual-core { position: absolute; top: 50%; left: 50%; display: grid; place-items: center; width: 180px; height: 180px; transform: translate(-50%, -50%); border: 1px solid rgba(255,255,255,.25); border-radius: 50%; background: radial-gradient(circle, #7669e4, #27235e 68%, transparent 69%); box-shadow: 0 0 70px rgba(104,92,225,.42); }
.core-spark { font-size: 30px; }.visual-core strong { margin-top: -10px; font-size: 13px; letter-spacing: .25em; }.visual-core small { margin-top: -40px; color: #c2beed; font-size: 10px; }
.floating-card { position: absolute; display: flex; align-items: center; gap: 10px; padding: 12px 15px; border: 1px solid rgba(255,255,255,.2); border-radius: 12px; background: rgba(28,28,70,.72); box-shadow: 0 12px 28px rgba(0,0,0,.2); backdrop-filter: blur(10px); }
.floating-card b, .floating-card small { display: block; }.floating-card b { color: #eeeaff; font-size: 12px; }.floating-card small { margin-top: 4px; color: #9393b1; font-size: 10px; }.card-icon { color: #aaa2ff; font-size: 20px; }.card-topic { top: 10%; right: 8%; }.card-video { left: 2%; bottom: 15%; }.card-review { right: 2%; bottom: 4%; }
.capabilities { display: grid; grid-template-columns: 180px 1fr; gap: 28px; padding: 68px 0; border-top: 1px solid rgba(255,255,255,.1); }.section-label span { color: #7c72ee; font-size: 12px; }.section-label p { margin-top: 12px; }
.capability-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; }.capability-grid article { padding: 8px 22px 8px 0; border-right: 1px solid rgba(255,255,255,.12); }.capability-grid article:last-child { border: 0; }.cap-number { color: #8b80f5; font-size: 11px; }.capability-grid h2 { margin: 18px 0 10px; font-size: 22px; }.capability-grid p { margin: 0; color: #9e9db4; font-size: 13px; line-height: 1.8; }
.public-data { max-width: 760px; margin-bottom: 38px; padding: 18px 20px; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; background: rgba(18,20,53,.6); }.data-heading { display: flex; justify-content: space-between; align-items: center; color: #bdb9dc; font-size: 12px; }.data-heading i { display: inline-block; width: 6px; height: 6px; margin-right: 8px; border-radius: 50%; background: #64d0a0; }.public-data pre { max-height: 180px; overflow: auto; margin: 14px 0 0; color: #9695b5; font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }.data-empty { margin: 14px 0 0; color: #787892; font-size: 12px; }
footer { padding: 22px 0; border-top: 1px solid rgba(255,255,255,.1); color: rgba(255,255,255,.42); font-size: 11px; } footer span { margin-left: 14px; color: rgba(255,255,255,.25); }
.ambient { position: absolute; z-index: 0; width: 350px; height: 350px; border-radius: 50%; filter: blur(80px); opacity: .18; }.ambient-one { top: 18%; left: 30%; background: #7568f4; }.ambient-two { right: -160px; bottom: 12%; background: #42b8d5; }
@media (max-width: 800px) { .public-page { padding: 0 20px; }.public-hero { min-height: auto; grid-template-columns: 1fr; padding: 76px 0 60px; }.hero-copy h1 { font-size: 58px; }.hero-visual { height: 300px; order: -1; transform: scale(.82); margin: -30px 0; }.capabilities { grid-template-columns: 1fr; padding: 48px 0; }.capability-grid { grid-template-columns: 1fr; gap: 22px; }.capability-grid article { border-right: 0; border-bottom: 1px solid rgba(255,255,255,.12); padding-bottom: 20px; }.public-nav { padding: 20px 0; }.brand { font-size: 9px; } }
</style>
