// Discord 승인 Bot
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';

// 설정 - 환경변수 사용
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'rhw0213';
const GITHUB_REPO = 'Test-project-S';
const APPROVAL_CHANNEL_ID = process.env.APPROVAL_CHANNEL_ID;

// Discord 클라이언트 생성
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// GitHub API 클라이언트
const octokit = new Octokit({
    auth: GITHUB_TOKEN
});

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
        await handleFileUpload(message);
    }
});

// 버튼 클릭 처리
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    console.log('버튼 클릭됨:', interaction.customId);
    
    // 첫 번째 언더스코어만으로 분할 (Upload ID에 언더스코어가 있을 수 있음)
    const underscoreIndex = interaction.customId.indexOf('_');
    const action = interaction.customId.substring(0, underscoreIndex);
    const uploadId = interaction.customId.substring(underscoreIndex + 1); // 나머지 전체
    
    console.log('액션:', action, '업로드 ID:', uploadId);
    console.log('현재 메모리 상태:', Array.from(pendingUploads.keys()));
    
    if (action === 'approve') {
        await approveUpload(interaction, uploadId, false); // 덮어쓰기 아님
    } else if (action === 'reject') {
        await rejectUpload(interaction, uploadId);
    } else if (action === 'overwrite') {
        await approveUpload(interaction, uploadId, true); // 덮어쓰기
    } else if (action === 'cancel') {
        await cancelUpload(interaction, uploadId);
    }
});

// 파일 업로드 처리
async function handleFileUpload(message) {
    console.log('파일 업로드 감지됨:', message.author.username);
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
        
        // 파일 중복 체크
        const isDuplicate = await checkFileExists(category, attachment.name);
        
        // 승인 요청 생성
        await createApprovalRequest(message, attachment, category, isDuplicate);
    }
}

// 파일 존재 여부 체크
async function checkFileExists(category, fileName) {
    try {
        const filePath = `Addressables/${category}/${fileName}`;
        
        await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filePath
        });
        
        console.log(`🔍 파일 중복 감지: ${fileName}`);
        return true; // 파일이 존재함
    } catch (error) {
        if (error.status === 404) {
            console.log(`✅ 새 파일: ${fileName}`);
            return false; // 파일이 존재하지 않음
        }
        console.error('파일 체크 중 오류:', error);
        return false;
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
        'ui': 'UI',
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
async function createApprovalRequest(originalMessage, attachment, category, isDuplicate) {
    const uploadId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log('승인 요청 생성:', uploadId, '중복 파일:', isDuplicate);
    
    // 임베드 색상과 제목 변경
    const embedColor = isDuplicate ? 0xFF9500 : 0xFFA500; // 중복 시 더 진한 주황색
    const embedTitle = isDuplicate ? '⚠️ 중복 파일 승인 요청' : '🎨 새 아트 파일 승인 요청';
    
    let embedDescription = `**${originalMessage.author.username}**님이 새 파일을 업로드했습니다.`;
    if (isDuplicate) {
        embedDescription += `\n\n⚠️ **동일한 이름의 파일이 이미 존재합니다!**\n기존 파일을 덮어쓸지 확인해주세요.`;
    }
    
    // 승인 요청 임베드 생성
    const embed = new EmbedBuilder()
        .setTitle(embedTitle)
        .setDescription(embedDescription)
        .setColor(embedColor)
        .addFields(
            { name: '📄 파일명', value: attachment.name, inline: true },
            { name: '📁 카테고리', value: category, inline: true },
            { name: '💾 파일 크기', value: formatFileSize(attachment.size), inline: true },
            { name: '👤 업로더', value: originalMessage.author.username, inline: true },
            { name: '🔗 원본 메시지', value: `[바로가기](${originalMessage.url})`, inline: true },
            { name: '📝 메시지', value: originalMessage.content || '없음', inline: false }
        )
        .setImage(attachment.url) // 이미지인 경우 미리보기
        .setTimestamp()
        .setFooter({ text: `Upload ID: ${uploadId}` });

    // 중복 파일일 때 경고 필드 추가
    if (isDuplicate) {
        embed.addFields(
            { name: '🚨 중복 경고', value: `기존 파일: \`Addressables/${category}/${attachment.name}\`\n이 파일을 덮어쓰면 **기존 데이터가 영구 삭제**됩니다!`, inline: false }
        );
    }

    // 버튼 구성 (중복 여부에 따라 다름)
    let buttons;
    
    if (isDuplicate) {
        // 중복 파일 - 덮어쓰기 옵션 제공
        buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`approve_${uploadId}`)
                    .setLabel('새 이름으로 승인')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`overwrite_${uploadId}`)
                    .setLabel('덮어쓰기')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔄'),
                new ButtonBuilder()
                    .setCustomId(`cancel_${uploadId}`)
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('❌'),
                new ButtonBuilder()
                    .setLabel('파일 다운로드')
                    .setStyle(ButtonStyle.Link)
                    .setURL(attachment.url)
                    .setEmoji('📥')
            );
    } else {
        // 새 파일 - 일반 승인/거부
        buttons = new ActionRowBuilder()
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
    }

    // 팀장 전용 채널에 전송
    const approvalChannel = client.channels.cache.get(APPROVAL_CHANNEL_ID);
    if (approvalChannel) {
        const approvalMessage = await approvalChannel.send({
            embeds: [embed],
            components: [buttons]
        });
        
        // 승인 요청 데이터 저장 (메모리 - 실제로는 DB 사용 권장)
        pendingUploads.set(uploadId, {
            originalMessage: originalMessage,
            attachment: attachment,
            category: category,
            approvalMessage: approvalMessage,
            uploader: originalMessage.author.username,
            uploadTime: new Date().toISOString(),
            isDuplicate: isDuplicate
        });
        
        console.log('메모리에 저장됨:', uploadId, '총 개수:', pendingUploads.size);
    } else {
        console.error('승인 채널을 찾을 수 없습니다:', APPROVAL_CHANNEL_ID);
    }
    
    // 원본 메시지에 답글
    const replyMessage = isDuplicate 
        ? '⚠️ 중복 파일이 감지되었습니다! 팀장의 확인을 기다려주세요.'
        : '📨 승인 요청이 팀장에게 전송되었습니다! 승인을 기다려주세요.';
        
    await originalMessage.reply(replyMessage);
}

// 승인 처리
async function approveUpload(interaction, uploadId, isOverwrite = false) {
    console.log('승인 처리 시작:', uploadId, '덮어쓰기:', isOverwrite);
    const uploadData = pendingUploads.get(uploadId);
    console.log('업로드 데이터 찾기 결과:', uploadData ? '찾음' : '못찾음');
    
    if (!uploadData) {
        console.log('사용 가능한 Upload ID들:', Array.from(pendingUploads.keys()));
        await interaction.reply({ 
            content: '❌ 업로드 정보를 찾을 수 없습니다.', 
            flags: 64 // ephemeral flag
        });
        return;
    }
    
    try {
        // 파일 다운로드
        const fileResponse = await fetch(uploadData.attachment.url);
        const fileBuffer = await fileResponse.buffer();
        const base64Content = fileBuffer.toString('base64');
        
        let filePath;
        let commitMessage;

        if (isOverwrite) {
            // 덮어쓰기 - 원본 이름 유지
            filePath = `Addressables/${uploadData.category}/${uploadData.attachment.name}`;
            commitMessage = `Overwrite ${uploadData.attachment.name} in ${uploadData.category} (approved by ${interaction.user.username})`;
        } else if (uploadData.isDuplicate) {
            // 중복 파일이지만 새 이름으로 저장
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const nameParts = uploadData.attachment.name.split('.');
            const extension = nameParts.pop();
            const baseName = nameParts.join('.');
            const newFileName = `${baseName}_${timestamp}.${extension}`;
            
            filePath = `Addressables/${uploadData.category}/${newFileName}`;
            commitMessage = `Add ${newFileName} to ${uploadData.category} (duplicate resolved by ${interaction.user.username})`;
        } else {
            // 일반 업로드
            filePath = `Addressables/${uploadData.category}/${uploadData.attachment.name}`;
            commitMessage = `Add ${uploadData.attachment.name} to ${uploadData.category} (approved by ${interaction.user.username})`;
        }

        // GitHub에 업로드 (덮어쓰기 시 SHA 가져오기)
        let sha = null;
        if (isOverwrite) {
            try {
                const existingFile = await octokit.repos.getContent({
                    owner: GITHUB_OWNER,
                    repo: GITHUB_REPO,
                    path: filePath
                });
                sha = existingFile.data.sha;
            } catch (error) {
                console.log('기존 파일 SHA 가져오기 실패 (새 파일로 처리)');
            }
        }

        const uploadParams = {
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filePath,
            message: commitMessage,
            content: base64Content,
            committer: {
                name: 'Art Upload Bot',
                email: 'bot@example.com'
            }
        };

        if (sha) {
            uploadParams.sha = sha; // 덮어쓰기 시 필요
        }

        await octokit.repos.createOrUpdateFileContents(uploadParams);
        
        // 승인 완료 임베드 업데이트
        const actionText = isOverwrite ? '덮어쓰기' : '승인';
        const successEmbed = new EmbedBuilder()
            .setTitle(`✅ 파일 ${actionText} 완료`)
            .setDescription(`**${uploadData.attachment.name}** 파일이 GitHub에 업로드되었습니다.`)
            .setColor(0x00FF00) // 초록색
            .addFields(
                { name: '📁 GitHub 경로', value: filePath, inline: false },
                { name: '🌐 접속 URL', value: `https://github.com/Rhw0213/Test-project-S/${filePath}`, inline: false },
                { name: '👤 승인자', value: interaction.user.username, inline: true },
                { name: '⏰ 승인 시간', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setTimestamp();

        if (isOverwrite) {
            successEmbed.addFields(
                { name: '🔄 처리 방식', value: '기존 파일 덮어쓰기', inline: true }
            );
        } else if (uploadData.isDuplicate) {
            successEmbed.addFields(
                { name: '🆕 처리 방식', value: '새 이름으로 저장', inline: true }
            );
        }

        // 버튼 비활성화
        const disabledButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('approved')
                    .setLabel(`${actionText} 완료`)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
                    .setDisabled(true)
            );

        await interaction.update({
            embeds: [successEmbed],
            components: [disabledButtons]
        });
        
        // 원본 메시지에 승인 알림
        const resultMessage = isOverwrite 
            ? `🔄 **${uploadData.attachment.name}** 파일이 덮어쓰기되었습니다!`
            : `✅ **${uploadData.attachment.name}** 파일이 승인되어 GitHub에 업로드되었습니다!`;
            
        await uploadData.originalMessage.reply(`${resultMessage}\n🌐 **Unity에서 사용 가능**: 약 5분 후`);
        
        // 메모리에서 제거
        pendingUploads.delete(uploadId);
        
    } catch (error) {
        console.error('GitHub 업로드 실패:', error);
        await interaction.reply({ 
            content: `❌ GitHub 업로드 실패: ${error.message}`, 
            flags: 64 // ephemeral flag
        });
    }
}

// 거부 처리
async function rejectUpload(interaction, uploadId) {
    const uploadData = pendingUploads.get(uploadId);
    
    if (!uploadData) {
        await interaction.reply({ 
            content: '❌ 업로드 정보를 찾을 수 없습니다.', 
            flags: 64 // ephemeral flag
        });
        return;
    }
    
    // 거부 임베드 업데이트
    const rejectEmbed = new EmbedBuilder()
        .setTitle('❌ 파일 거부됨')
        .setDescription(`**${uploadData.attachment.name}** 파일이 거부되었습니다.`)
        .setColor(0xFF0000) // 빨간색
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
}

// 취소 처리
async function cancelUpload(interaction, uploadId) {
    const uploadData = pendingUploads.get(uploadId);
    
    if (!uploadData) {
        await interaction.reply({ 
            content: '❌ 업로드 정보를 찾을 수 없습니다.', 
            flags: 64
        });
        return;
    }
    
    // 취소 임베드 업데이트
    const cancelEmbed = new EmbedBuilder()
        .setTitle('🚫 업로드 취소됨')
        .setDescription(`**${uploadData.attachment.name}** 파일 업로드가 취소되었습니다.`)
        .setColor(0x6C757D)
        .addFields(
            { name: '👤 취소자', value: interaction.user.username, inline: true },
            { name: '⏰ 취소 시간', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        )
        .setTimestamp();

    // 버튼 비활성화
    const disabledButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('cancelled')
                .setLabel('취소됨')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🚫')
                .setDisabled(true)
        );

    await interaction.update({
        embeds: [cancelEmbed],
        components: [disabledButtons]
    });
    
    // 원본 메시지에 취소 알림
    await uploadData.originalMessage.reply(`🚫 **${uploadData.attachment.name}** 파일 업로드가 취소되었습니다.\n💬 **취소자**: ${interaction.user.username}`);
    
    // 메모리에서 제거
    pendingUploads.delete(uploadId);
}

// 파일 크기 포맷팅
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 대기 중인 업로드 저장 (실제로는 데이터베이스 사용 권장)
const pendingUploads = new Map();

// 봇 로그인
client.login(DISCORD_TOKEN);

// Render를 위한 HTTP 서버
import express from 'express';
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({
        status: 'Discord Bot is running!',
        bot: client.user?.tag || 'Not logged in',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        guilds: client.guilds.cache.size,
        pendingUploads: pendingUploads.size
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        bot_ready: client.isReady(),
        guilds: client.guilds.cache.size
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP 서버가 포트 ${PORT}에서 실행 중입니다.`);
});

// 에러 처리
client.on('error', console.error);
process.on('unhandledRejection', console.error);