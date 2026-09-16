import React, {
  useRef,
  useCallback,
  useEffect,
  type ReactElement,
  type ReactNode,
} from 'react';
import { GestureDetector } from 'react-native-gesture-handler';
import { useKeyboardAwareChat } from './useKeyboardAwareChat';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  type FlatListProps,
  type ListRenderItem,
  Platform,
} from 'react-native';

import { ArrowDown, Download } from 'lucide-react-native';
import type { UIMessage } from 'ai';
import { Message, MessageContent, MessageResponse } from './message';
import { BlankProvider, useBlankContext } from './blank-context';
/**
 * Two subpaths, because `@legendapp/list` declares no root export at all.
 *
 * Only `./reanimated`, `./animated`, `./react-native` and friends, so the CLI's
 * bare `from '@legendapp/list'` resolved to nothing and `tsc` refused the file.
 * The animated component is on `./reanimated`; the types it is described with
 * are on `./react-native`, which is the package that owns them.
 */
import {
  AnimatedLegendList,
  type AnimatedLegendListProps,
} from '@legendapp/list/reanimated';
import type {
  LegendListRef,
  LegendListRenderItemProps,
} from '@legendapp/list/react-native';

export type ConversationProps = {
  children?: ReactNode;
  className?: string;
};

export const Conversation = ({ children, className }: ConversationProps) => (
  <BlankProvider>
    <View className={`flex-1 bg-background px-4 ${className || ''}`}>
      {children}
    </View>
  </BlankProvider>
);

export type ConversationEmptyStateProps = {
  title?: string;
  description?: string;
  icon?: ReactElement;
  className?: string;
};

export const ConversationEmptyState = ({
  title = 'Start a conversation',
  description = 'Type a message below to begin chatting',
  icon, 
  className,
}: ConversationEmptyStateProps) => (
  <View className={`flex-1  items-center justify-center   ${className || ''}`}>
    <Text className="mt-4 text-3xl font-semibold text-foreground">{title}</Text>
  </View>
);

/**
 * `LegendList`'s render item, not React Native's.
 *
 * The CLI typed this as `ListRenderItem`, which carries a `separators` the
 * legend list does not pass — so the component did not typecheck and a caller
 * writing against the declared type would have been handed an object missing a
 * property it was promised.
 */
export type ConversationRenderItem = (
  props: LegendListRenderItemProps<UIMessage, string | undefined>,
) => ReactNode;

/**
 * The legend list's props, not `FlatList`'s.
 *
 * Same correction as `Attachments` needed: the CLI typed the spread against one
 * component and spread it onto another, so `tsc` refused the call and a caller
 * passing a documented `FlatList` prop would have been passing it to something
 * that does not take it.
 */
export type ConversationContentProps = {
  messages: UIMessage[];
  renderItem?: ConversationRenderItem;
  estimatedItemSize?: number;
} & Omit<
  AnimatedLegendListProps<UIMessage>,
  'data' | 'renderItem' | 'ref' | 'refLegendList' | 'keyExtractor'
>;

export const ConversationContent = ({
  messages,
  renderItem,
  estimatedItemSize = 140,
  ...flatListProps
}: ConversationContentProps) => {
  // The list rendered below is always the legend list, so the ref is one. The
  // CLI typed it as a union with `FlatList`, which nothing here renders — and a
  // union ref cannot be handed to either component.
  const flatListRef = useRef<LegendListRef>(null);

  const defaultRenderItem: ConversationRenderItem = useCallback(
    ({ item: message, index }) => (
      <Message role={message.role} index={index} message={message}>
        <MessageContent>
          {message.parts
            ?.filter((part: { type: string }) => part.type === 'text')
            .map((_part: unknown, i: number) => <MessageResponse key={i} message={message} />)}
        </MessageContent>
      </Message>
    ),
    []
  );

  const { scrollHandler, panGesture } = useKeyboardAwareChat();
  const { blankSize } = useBlankContext();

  const prevLengthRef = useRef(messages.length);

  useEffect(() => {
    const shouldScroll =
      messages.length > prevLengthRef.current &&
      messages[messages.length - 1].role === 'user';

    if (shouldScroll && Platform.OS !== 'web') {
      flatListRef.current?.scrollToEnd?.();
    }
    prevLengthRef.current = messages.length;
  }, [messages]);

  const { messagesContainerHeight } = useBlankContext();



  return (
   
    <View
      className="flex-1"
      onLayout={(e) => {
        const height = e.nativeEvent.layout.height;
        messagesContainerHeight.value = height;
      }}
    >
      {messages.length === 0 ? (
        <ConversationEmptyState />
      ) : (
        // Four `FlatList` virtualisation props were passed here and removed:
        // `removeClippedSubviews`, `initialNumToRender`, `windowSize` and
        // `maxToRenderPerBatch`. The legend list does its own windowing off
        // `estimatedItemSize` and takes none of them, so each was a type error
        // and a no-op.
        <AnimatedLegendList
          ref={flatListRef}
          data={messages}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          renderItem={renderItem || defaultRenderItem}
          keyExtractor={(item) => item.id}
          scrollEventThrottle={16}
          estimatedItemSize={estimatedItemSize}
          contentContainerStyle={{
            paddingBottom: blankSize.value,
          }}
          {...flatListProps}
        />
      )}
    </View>
  
  );
};


export const ConversationScrollButton = () => (
  <TouchableOpacity
    onPress={() => {}}
    className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-primary h-11 w-11 items-center justify-center rounded-full shadow-lg"
  >
    <ArrowDown size={22} className="text-primary-foreground" />
  </TouchableOpacity>
);

export type ConversationDownloadProps = { messages: UIMessage[] };

export const ConversationDownload = ({
  messages,
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messages
      .map((msg) => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const text = msg.parts
          ?.filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
        return `**${role}:**\n${text}`;
      })
      .join('\n\n');
    Alert.alert('Download', `Markdown ready (${messages.length} messages)`);
  }, [messages]);

  return (
    <TouchableOpacity
      onPress={handleDownload}
      className="absolute top-4 right-4 bg-card p-3 rounded-2xl shadow-sm"
    >
      <Download size={20} className="text-muted-foreground" />
    </TouchableOpacity>
  );
};
