<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Goal, GoalPeriod, Topic } from '~/types/database'

/**
 * Create / edit one goal.
 *
 * The unique index on `goals` is partial (`where active`), so an active goal
 * already sitting on the chosen (topic, period) pair is a hard conflict. This
 * form detects it BEFORE submit and offers to edit that goal instead — the
 * mapped constraint message in `errors.ts` is the backstop for a race, not the
 * plan. Letting the user hit save and bounce off a Postgres error would be a
 * worse version of information the form already has.
 *
 * `target_minutes` is minutes, matching the column. No conversion happens here;
 * `useGoals` does it once when it compares against `focus_seconds`.
 */
const props = defineProps<{
  /** null = create mode. */
  goal: Goal | null
  topics: Topic[]
  saving?: boolean
}>()

const emit = defineEmits<{
  submit: [value: { topic_id: string | null, period: GoalPeriod, target_minutes: number }]
  cancel: []
  /** Raised when the user chooses to edit the conflicting goal instead. */
  editConflict: [goal: Goal]
}>()

const { conflictFor } = useGoals()

const ALL_TOPICS = '__all__'

const state = reactive({
  topicValue: ALL_TOPICS as string,
  period: 'daily' as GoalPeriod,
  target_minutes: 60
})

// Re-seed whenever the caller swaps which goal is being edited, including the
// null -> goal transition when "Edit" is pressed on an existing row.
watch(
  () => props.goal,
  (goal) => {
    state.topicValue = goal?.topic_id ?? ALL_TOPICS
    state.period = goal?.period ?? 'daily'
    state.target_minutes = goal?.target_minutes ?? 60
  },
  { immediate: true }
)

/** Archived topics stay off the picker but remain valid on an existing goal. */
const topicItems = computed(() => [
  { label: 'All topics', value: ALL_TOPICS },
  ...props.topics.map(topic => ({ label: topic.name, value: topic.id }))
])

const periodItems = computed(() =>
  GOAL_PERIODS.map(period => ({ label: PERIOD_LABELS[period], value: period }))
)

const selectedTopicId = computed(() => (state.topicValue === ALL_TOPICS ? null : state.topicValue))

const conflict = computed(() =>
  conflictFor(selectedTopicId.value, state.period, props.goal?.id)
)

const conflictLabel = computed(() => {
  const other = conflict.value
  if (!other) return ''
  const name = other.topic_id === null
    ? 'All topics'
    : props.topics.find(topic => topic.id === other.topic_id)?.name ?? 'that topic'
  return `${PERIOD_LABELS[other.period]} · ${name}`
})

function validate(data: typeof state) {
  const errors: Array<{ name: string, message: string }> = []
  if (!Number.isInteger(data.target_minutes) || data.target_minutes < 1) {
    errors.push({ name: 'target_minutes', message: 'Target must be at least 1 minute' })
  }
  return errors
}

function onSubmit(event: FormSubmitEvent<typeof state>) {
  if (conflict.value) return
  emit('submit', {
    topic_id: event.data.topicValue === ALL_TOPICS ? null : event.data.topicValue,
    period: event.data.period,
    target_minutes: event.data.target_minutes
  })
}
</script>

<template>
  <UForm
    :state="state"
    :validate="validate"
    class="flex flex-col gap-4"
    @submit="onSubmit"
  >
    <UFormField
      label="Topic"
      name="topicValue"
      help="A goal on a parent topic counts its sub-topics too."
    >
      <USelectMenu
        v-model="state.topicValue"
        :items="topicItems"
        value-key="value"
        :disabled="saving"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Period"
      name="period"
    >
      <USelectMenu
        v-model="state.period"
        :items="periodItems"
        value-key="value"
        :disabled="saving"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Target"
      name="target_minutes"
      help="Minutes of focused study in the period."
      required
    >
      <UInputNumber
        v-model="state.target_minutes"
        :min="1"
        :step="15"
        :disabled="saving"
        class="w-40"
      />
    </UFormField>

    <!-- Pre-empting the partial unique index. Offering the edit is the point:
         the user's intent is "I want a target here", and they already have one. -->
    <UAlert
      v-if="conflict"
      color="warning"
      variant="soft"
      icon="i-lucide-info"
      title="You already have that goal"
      :description="`${conflictLabel} is already active. Edit it instead of creating a second one.`"
      :actions="[{
        label: 'Edit that goal',
        color: 'neutral',
        variant: 'outline',
        onClick: () => emit('editConflict', conflict!)
      }]"
    />

    <div class="flex items-center justify-end gap-2 pt-2">
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        :disabled="saving"
        @click="emit('cancel')"
      >
        Cancel
      </UButton>
      <UButton
        type="submit"
        :loading="saving"
        :disabled="saving || conflict !== null"
        icon="i-lucide-check"
      >
        {{ goal ? 'Save goal' : 'Add goal' }}
      </UButton>
    </div>
  </UForm>
</template>
