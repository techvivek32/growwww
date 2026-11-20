import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// The notification feed, and the web's `/notifications`.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  int _rev = 0;

  Future<void> _markRead() async {
    try {
      await api.markNotificationsRead();
      if (mounted) setState(() => _rev++);
    } on ApiError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(onPressed: _markRead, child: const Text('Mark all read')),
          const SizedBox(width: 6),
        ],
      ),
      body: Load<({List<Notif> items, int unread})>(
        key: ValueKey(_rev),
        load: api.notifications,
        builder: (d) {
          if (d.items.isEmpty) {
            return ListView(
              children: const [
                SizedBox(
                  height: 400,
                  child: Empty(
                    icon: Icons.notifications_none,
                    title: 'Nothing yet',
                    detail:
                        'Settlement notices, membership changes and account '
                        'alerts appear here.',
                  ),
                ),
              ],
            );
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              for (final n in d.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Panel(
                    padding: const EdgeInsets.all(13),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            if (!n.read) ...[
                              Container(
                                width: 7,
                                height: 7,
                                decoration: const BoxDecoration(
                                  color: T.mark,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 8),
                            ],
                            Expanded(
                              child: Text(
                                n.title,
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: n.read ? FontWeight.w500 : FontWeight.w700,
                                ),
                              ),
                            ),
                            Text(
                              ago(n.createdAt),
                              style: TextStyle(
                                fontSize: 10.5,
                                color: Theme.of(context)
                                    .colorScheme
                                    .onSurface
                                    .withValues(alpha: 0.45),
                              ),
                            ),
                          ],
                        ),
                        if (n.body.isNotEmpty) ...[
                          const SizedBox(height: 6),
                          Text(
                            n.body,
                            style: TextStyle(
                              fontSize: 12.5,
                              height: 1.5,
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurface
                                  .withValues(alpha: 0.65),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
