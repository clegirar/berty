import React, { useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, TouchableOpacity, View } from 'react-native'
import { Icon, Text } from '@ui-kitten/components'
import { CommonActions } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { KeyboardAvoidingView } from '@berty-tech/components/shared-components/KeyboardAvoidingView'
import { useStyles } from '@berty-tech/styles'
import { Routes, ScreenProps, useNavigation } from '@berty-tech/navigation'
import beapi from '@berty-tech/api'
import {
	useContact,
	useConversation,
	useReadEffect,
	useNotificationsInhibitor,
} from '@berty-tech/store/hooks'

import BlurView from '../shared-components/BlurView'
import { ContactAvatar } from '../avatars'
import { useLayout } from '../hooks'
import { ChatDate, ChatFooter } from './common'
import { SwipeNavRecognizer } from '../shared-components/SwipeNavRecognizer'
import { MessageList } from '@berty-tech/components/chat/MessageList'

//
// Chat
//

const CenteredActivityIndicator: React.FC = (props: ActivityIndicator['props']) => {
	const { ...propsToPass } = props
	return (
		<View style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
			<ActivityIndicator {...propsToPass} />
		</View>
	)
}

export const ChatHeader: React.FC<{ convPk: any; stickyDate: any; showStickyDate: any }> = ({
	convPk,
	stickyDate,
	showStickyDate,
}) => {
	const insets = useSafeAreaInsets()
	const { navigate, goBack } = useNavigation()
	const conv = useConversation(convPk)
	const contact = useContact(conv?.contactPublicKey || null)

	const [{ padding, text, opacity, color }] = useStyles()

	const [layoutHeader, onLayoutHeader] = useLayout() // to position date under blur

	if (!conv || !contact) {
		goBack()
		console.warn('OneToOne: no conv', conv, contact)
		return <CenteredActivityIndicator />
	}
	const title = (conv as any).fake ? `FAKE - ${contact.displayName}` : contact?.displayName || ''
	const outerElemsSize = 45
	return (
		<View style={{ position: 'absolute', top: 0, left: 0, right: 0 }} onLayout={onLayoutHeader}>
			<BlurView
				blurType='light'
				blurAmount={30}
				style={{ position: 'absolute', bottom: 0, top: 0, left: 0, right: 0 }}
			/>
			<View
				style={[
					{
						alignItems: 'center',
						flexDirection: 'row',
						justifyContent: 'space-between',
						marginTop: insets.top,
					},
					padding.medium,
				]}
			>
				<TouchableOpacity onPress={goBack} style={{ width: outerElemsSize }}>
					<Icon name='arrow-back-outline' width={25} height={25} fill={color.black} />
				</TouchableOpacity>
				<Text numberOfLines={1} style={[text.bold.medium, text.size.scale(20)]}>
					{title}
				</Text>
				<TouchableOpacity
					activeOpacity={contact ? 0.2 : 0.5}
					style={[!contact ? opacity(0.5) : null]}
					onPress={() => navigate.chat.oneToOneSettings({ convId: convPk })}
				>
					<ContactAvatar size={outerElemsSize} publicKey={conv.contactPublicKey} />
				</TouchableOpacity>
			</View>
			{stickyDate && showStickyDate && layoutHeader?.height && (
				<View
					style={{
						position: 'absolute',
						top: layoutHeader.height + 10,
						left: 0,
						right: 0,
					}}
				>
					<ChatDate date={stickyDate} />
				</View>
			)}
		</View>
	)
}

const NT = beapi.messenger.StreamEvent.Notified.Type

export const OneToOne: React.FC<ScreenProps.Chat.OneToOne> = ({ route: { params } }) => {
	useNotificationsInhibitor((_ctx, notif) => {
		if (
			(notif.type === NT.TypeContactRequestSent &&
				(notif.payload as any)?.payload?.contact?.conversationPublicKey === params?.convId) ||
			(notif.type === NT.TypeMessageReceived &&
				(notif.payload as any)?.payload?.interaction?.conversationPublicKey === params?.convId)
		) {
			return 'sound-only'
		}
		return false
	})

	const [inputIsFocused, setInputFocus] = useState(false)
	const [{ flex, background }] = useStyles()
	useReadEffect(params?.convId, 1000)
	const { dispatch } = useNavigation()
	const { t } = useTranslation()
	const conv = useConversation(params?.convId)
	const contact = useContact(conv?.contactPublicKey)

	const isIncoming = contact?.state === beapi.messenger.Contact.State.IncomingRequest
	const isFooterDisable = isIncoming
	const placeholder = isFooterDisable
		? t('chat.one-to-one.incoming-input-placeholder')
		: t('chat.one-to-one.input-placeholder')

	const [stickyDate, setStickyDate] = useState(conv?.lastUpdate || null)
	const [showStickyDate, setShowStickyDate] = useState(false)
	const [isSwipe, setSwipe] = useState(true)

	return (
		<View style={[StyleSheet.absoluteFill, background.white, { flex: 1 }]}>
			<SwipeNavRecognizer
				onSwipeLeft={() =>
					isSwipe &&
					dispatch(
						CommonActions.navigate({
							name: Routes.Chat.OneToOneSettings,
							params: { convId: params?.convId },
						}),
					)
				}
			>
				<KeyboardAvoidingView
					style={[flex.tiny, { justifyContent: 'flex-start' }]}
					behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				>
					<MessageList
						id={params?.convId}
						scrollToMessage={params?.scrollToMessage || '0'}
						{...{ setStickyDate, setShowStickyDate }}
					/>
					<ChatFooter
						convPk={params?.convId}
						isFocused={inputIsFocused}
						setFocus={setInputFocus}
						disabled={isFooterDisable}
						placeholder={placeholder}
						setSwipe={setSwipe}
					/>
					<ChatHeader convPk={params?.convId || ''} {...{ stickyDate, showStickyDate }} />
				</KeyboardAvoidingView>
			</SwipeNavRecognizer>
		</View>
	)
}
