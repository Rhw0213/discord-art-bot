
// Discord 승인 Bot
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';

// 설정 - 여기를 수정하세요!
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;        // 복사한 Discord 봇 토큰
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;              // 복사한 GitHub 토큰  
const APPROVAL_CHANNEL_ID = process.env.APPROVAL_CHANNEL_ID // #art-approval 채널 ID
const GITHUB_OWNER = 'rhw0213';                        // GitHub 사용자명
const GITHUB_REPO = 'Test-project-S';                  // GitHub 저장소명

// Discord 클라이언트 생성
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// GitHub API 클라이언트
const octokit = new Octokit({
    auth: GITHUB_TOKEN
});

// 대기 중인 업로드 저장
const pendingUploads = new Map();

// 봇 준비 완료
client.once('ready', () => {
    console.log(`✅ ${client.user.tag} 봇이 준비되었습니다!`);
});

// 메시지 처리
client.on('messageCreate', async (message) => {
    // 봇 메시지 무시
    if (message.author.bot) return;

    // 파일이 첨부된 메시지만 처리
    if (message.attachments.size > 0) {
        console.log('파일 업로드 감지됨:', message.author.username);
        await handleFileUpload(message);
    }
});

// 버튼 클릭 처리
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    console.log('버튼 클릭됨:', interaction.customId);
    console.log('현재 Map 상태:', Array.from(pendingUploads.keys()));

    // 첫 번째 언더스코어만으로 분할
    const underscoreIndex = interaction.customId.indexOf('_');
    const action = interaction.customId.substring(0, underscoreIndex);
    const uploadId = interaction.customId.substring(underscoreIndex + 1);

    console.log('액션:', action, '업로드 ID:', uploadId);
    console.log('전체 customId:', interaction.customId);

    if (action === 'approve') {
        await approveUpload(interaction, uploadId);
    } else if (action === 'reject') {
        await rejectUpload(interaction, uploadId);
    }
});

// 파일 업로드 처리
async function handleFileUpload(message) {
    const attachments = Array.from(message.attachments.values());

    for (const attachment of attachments) {
        console.log('파일 처리 중:', attachment.name);

        // 파일 크기 체크 (100MB 제한)
        if (attachment.size > 100 * 1024 * 1024) {
            await message.reply('❌ 파일 크기가 100MB를 초과합니다.');
            continue;
        }

        // 카테고리 추출 (메시지에서)
        const category = extractCategory(message.content);
        console.log('카테고리:', category);

        // 승인 요청 생성
        await createApprovalRequest(message, attachment, category);
    }
}

// 메시지에서 카테고리 추출
function extractCategory(content) {
    const categories = {
        '캐릭터': 'Characters',
        'character': 'Characters',
        '무기': 'Weapons',
        'weapon': 'Weapons',
        '배경': 'Environments',
        'environment': 'Environments',
        'ui': 'Ui',
        '이펙트': 'Effects',
        'effect': 'Effects',
        '오디오': 'Audio',
        'audio': 'Audio',
        '텍스처': 'Textures',
        'texture': 'Textures'
    };

    const lowerContent = content.toLowerCase();

    for (const [key, value] of Object.entries(categories)) {
        if (lowerContent.includes(key)) {
            return value;
        }
    }

    return 'Other'; // 기본값
}

// 승인 요청 생성
async function createApprovalRequest(originalMessage, attachment, category) {
    const uploadId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log('승인 요청 생성:', uploadId);

    // 데이터 생성
    const uploadData = {
        originalMessage: originalMessage,
        attachment: attachment,
        category: category,
        uploader: originalMessage.author.username,
        uploadTime: new Date().toISOString()
    };

    // 메모리에 저장
    pendingUploads.set(uploadId, uploadData);
    console.log('메모리에 저장됨:', uploadId, '총 개수:', pendingUploads.size);
    console.log('저장 후 키 확인:', pendingUploads.has(uploadId));

    // 승인 요청 임베드 생성
    const embed = new EmbedBuilder()
        .setTitle('🎨 새 아트 파일 승인 요청')
        .setDescription(`**${originalMessage.author.username}**님이 새 파일을 업로드했습니다.`)
        .setColor(0xFFA500)
        .addFields(
            { name: '📄 파일명', value: attachment.name, inline: true },
            { name: '📁 카테고리', value: category, inline: true },
            { name: '💾 파일 크기', value: formatFileSize(attachment.size), inline: true },
            { name: '👤 업로더', value: originalMessage.author.username, inline: true },
            { name: '🔗 원본 메시지', value: `[바로가기](${originalMessage.url})`, inline: true },
            { name: '📝 메시지', value: originalMessage.content || '없음', inline: false }
        )
        .setImage(attachment.url)
        .setTimestamp()
        .setFooter({ text: `Upload ID: ${uploadId}` });

    // 승인/거부 버튼
    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`approve_${uploadId}`)
                .setLabel('승인')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
            new ButtonBuilder()
                .setCustomId(`reject_${uploadId}`)
                .setLabel('거부')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌'),
            new ButtonBuilder()
                .setLabel('파일 다운로드')
                .setStyle(ButtonStyle.Link)
                .setURL(attachment.url)
                .setEmoji('📥')
        );

    // 팀장 전용 채널에 전송
    const approvalChannel = client.channels.cache.get(APPROVAL_CHANNEL_ID);
    if (approvalChannel) {
        try {
            const approvalMessage = await approvalChannel.send({
                embeds: [embed],
                components: [buttons]
            });

            console.log('Discord 메시지 전송 완료');
        } catch (error) {
            console.error('Discord 메시지 전송 실패:', error);
        }
    } else {
        console.error('승인 채널을 찾을 수 없습니다:', APPROVAL_CHANNEL_ID);
    }

    // 원본 메시지에 답글
    try {
        await originalMessage.reply('📨 승인 요청이 팀장에게 전송되었습니다! 승인을 기다려주세요.');
    } catch (error) {
        console.error('원본 메시지 답글 실패:', error);
    }
}

// 승인 처리
async function approveUpload(interaction, uploadId) {
    console.log('승인 처리 시작:', uploadId);
    console.log('현재 Map 키들:', Array.from(pendingUploads.keys()));
    console.log('Map 크기:', pendingUploads.size);

    const uploadData = pendingUploads.get(uploadId);
    console.log('업로드 데이터 조회 결과:', uploadData ? '찾음' : '못찾음');

    if (!uploadData) {
        console.log('❌ 데이터 못찾음. 키 비교:');
        for (const key of pendingUploads.keys()) {
            console.log(`저장된 키: "${key}" vs 요청 키: "${uploadId}" 같음: ${key === uploadId}`);
        }
        await interaction.reply({
            content: '❌ 업로드 정보를 찾을 수 없습니다.',
            flags: 64
        });
        return;
    }

    try {
        // 파일 다운로드
        console.log('파일 다운로드 시작:', uploadData.attachment.url);
        const fileResponse = await fetch(uploadData.attachment.url);
        const fileBuffer = await fileResponse.buffer();
        const base64Content = fileBuffer.toString('base64');

        // GitHub에 업로드
        const filePath = `Addressables/${uploadData.category}/${uploadData.attachment.name}`;
        console.log('GitHub 업로드 경로:', filePath);

        await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filePath,
            message: `Add ${uploadData.attachment.name} to ${uploadData.category} (approved by ${interaction.user.username})`,
            content: base64Content,
            committer: {
                name: 'Art Upload Bot',
                email: 'bot@example.com'
            }
        });

        console.log('GitHub 업로드 성공!');

        // 승인 완료 임베드 업데이트
        const successEmbed = new EmbedBuilder()
            .setTitle('✅ 파일 승인 완료')
            .setDescription(`**${uploadData.attachment.name}** 파일이 GitHub에 업로드되었습니다.`)
            .setColor(0x00FF00)
            .addFields(
                { name: '📁 GitHub 경로', value: `addressables/${uploadData.category}/${uploadData.attachment.name}`, inline: false },
                { name: '🌐 접속 URL', value: `https://rhw0213.github.io/Test-project-S/addressables/${uploadData.category}/${uploadData.attachment.name}`, inline: false },
                { name: '👤 승인자', value: interaction.user.username, inline: true },
                { name: '⏰ 승인 시간', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setTimestamp();

        // 버튼 비활성화
        const disabledButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('approved')
                    .setLabel('승인됨')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
                    .setDisabled(true)
            );

        await interaction.update({
            embeds: [successEmbed],
            components: [disabledButtons]
        });

        // 원본 메시지에 승인 알림
        await uploadData.originalMessage.reply(`✅ **${uploadData.attachment.name}** 파일이 승인되어 GitHub에 업로드되었습니다!\n🌐 **Unity에서 사용 가능**: 약 5분 후`);

        // 메모리에서 제거
        pendingUploads.delete(uploadId);
        console.log('승인 처리 완료, 메모리에서 제거');

    } catch (error) {
        console.error('GitHub 업로드 실패:', error);
        await interaction.reply({
            content: `❌ GitHub 업로드 실패: ${error.message}`,
            flags: 64
        });
    }
}

// 거부 처리
async function rejectUpload(interaction, uploadId) {
    console.log('거부 처리 시작:', uploadId);

    const uploadData = pendingUploads.get(uploadId);
    console.log('거부 - 업로드 데이터:', uploadData ? '찾음' : '못찾음');

    if (!uploadData) {
        await interaction.reply({
            content: '❌ 업로드 정보를 찾을 수 없습니다.',
            flags: 64
        });
        return;
    }

    // 거부 임베드 업데이트
    const rejectEmbed = new EmbedBuilder()
        .setTitle('❌ 파일 거부됨')
        .setDescription(`**${uploadData.attachment.name}** 파일이 거부되었습니다.`)
        .setColor(0xFF0000)
        .addFields(
            { name: '👤 거부자', value: interaction.user.username, inline: true },
            { name: '⏰ 거부 시간', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        )
        .setTimestamp();

    // 버튼 비활성화
    const disabledButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('rejected')
                .setLabel('거부됨')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌')
                .setDisabled(true)
        );

    await interaction.update({
        embeds: [rejectEmbed],
        components: [disabledButtons]
    });

    // 원본 메시지에 거부 알림
    await uploadData.originalMessage.reply(`❌ **${uploadData.attachment.name}** 파일이 거부되었습니다.\n💬 **거부자**: ${interaction.user.username}`);

    // 메모리에서 제거
    pendingUploads.delete(uploadId);
    console.log('거부 처리 완료, 메모리에서 제거');
}

// 파일 크기 포맷팅
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 봇 로그인
client.login(DISCORD_TOKEN);

// 에러 처리
client.on('error', console.error);
process.on('unhandledRejection', console.error);