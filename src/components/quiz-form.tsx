// The open quiz attempt (T42, SPEC-verification.md): each question with a box for the answer. A
// listening question has Play, which reads its phrase aloud (expo-speech) in the challenge's
// language; the phrase is never shown. Answers go to the quiz function once every box is filled.

import * as Speech from 'expo-speech';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { inputStyle, PLACEHOLDER_COLOR, SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';

import type { Question } from '../../supabase/functions/_shared/quiz';

export function QuizForm({
  questions,
  speechLanguage,
  busy,
  onSubmit,
}: {
  questions: Question[];
  /** The voice for listening questions (BCP 47), e.g. "es-ES". */
  speechLanguage?: string;
  busy: boolean;
  onSubmit: (answers: string[]) => void;
}) {
  const styles = useStyles(makeStyles);
  const [answers, setAnswers] = useState(() => questions.map(() => ''));

  return (
    <View style={styles.quiz}>
      {questions.map((q, i) => (
        <View key={i} style={styles.question}>
          <Text style={styles.prompt}>
            {i + 1}. {q.prompt}
          </Text>
          {q.speak && (
            <>
              <Button title="Play" variant="secondary" onPress={() => Speech.speak(q.speak!, { language: speechLanguage })} />
              <Text style={styles.hint}>No sound? Turn off silent mode.</Text>
            </>
          )}
          <TextInput
            style={styles.input}
            placeholder="Your answer"
            placeholderTextColor={PLACEHOLDER_COLOR}
            accessibilityLabel={`Answer to question ${i + 1}`}
            value={answers[i]}
            onChangeText={(text) => setAnswers((all) => all.map((a, j) => (j === i ? text : a)))}
            maxLength={300}
            autoCorrect={false}
          />
        </View>
      ))}
      <Button
        title={busy ? 'Checking…' : 'Send answers'}
        onPress={() => onSubmit(answers)}
        disabled={busy || answers.some((a) => !a.trim())}
      />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    quiz: { gap: SPACE.xl },
    question: { gap: SPACE.sm },
    prompt: { ...TEXT.row, lineHeight: 23, color: c.text },
    hint: { ...TEXT.caption, color: c.secondaryText },
    input: inputStyle(c),
  });
