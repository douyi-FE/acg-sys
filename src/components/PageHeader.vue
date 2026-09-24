<script setup lang="ts">
defineProps<{ title: string; description?: string; eyebrow?: string }>()
</script>
<template>
  <header class="page-header">
    <div>
      <span
        v-if="eyebrow"
        class="eyebrow"
        >{{ eyebrow }}</span
      >
      <h1>{{ title }}</h1>
      <p
        v-if="description"
        class="muted"
      >
        {{ description }}
      </p>
    </div>
    <div class="header-actions"><slot /></div>
  </header>
</template>
