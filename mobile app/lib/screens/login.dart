import 'package:flutter/material.dart';
import '../api/client.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'admin.dart';
import 'signup.dart';
import 'shell.dart';

/// Sign-in. Mirrors the web form: email + password, posted to the server,
/// which answers with the signed session token.
///
/// The password never leaves this screen except in that one request, and is
/// never written to storage — only the returned token is, and that expires in
/// eight hours regardless of what the app does.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _busy = false;
  bool _show = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate() || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final next = await api.login(_email.text.trim(), _password.text);
      if (!mounted) return;
      // The admin login is a console, not a trading account — it opens the
      // admin pages and nothing else. Sending it into the member shell would
      // mean every tab there answering 307, which the client reads as an
      // expired session and signs out: a login that bounces straight back to
      // this screen.
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => next == '/admin'
              ? const AdminScreen(isRoot: true)
              : Shell(landing: next),
        ),
      );
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not reach the server. Check your connection.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: T.dBg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Form(
                key: _form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // The house mark: four ascending bars, the last in
                    // vermilion. The same shape as the launcher icon.
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        for (final h in const [14.0, 23.0, 31.0, 42.0])
                          Container(
                            width: 11,
                            height: h,
                            margin: const EdgeInsets.only(right: 5),
                            color: h == 42.0 ? T.mark : T.dInk,
                          ),
                      ],
                    ),
                    const SizedBox(height: 28),
                    const EnvBanner(),
                    const Text(
                      'Welcome back.',
                      style: TextStyle(
                        fontSize: 32,
                        height: 1.05,
                        fontWeight: FontWeight.w600,
                        color: T.dInk,
                        letterSpacing: -0.6,
                      ),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      'Sign in to your desk.',
                      style: TextStyle(fontSize: 15, color: T.dInk3, height: 1.5),
                    ),
                    const SizedBox(height: 30),

                    _field(
                      controller: _email,
                      label: 'Email',
                      keyboard: TextInputType.emailAddress,
                      validator: (v) =>
                          (v == null || !v.contains('@')) ? 'Enter your email address.' : null,
                    ),
                    const SizedBox(height: 14),
                    _field(
                      controller: _password,
                      label: 'Password',
                      obscure: !_show,
                      validator: (v) =>
                          (v == null || v.isEmpty) ? 'Enter your password.' : null,
                      onSubmit: _submit,
                      suffix: IconButton(
                        icon: Icon(
                          _show ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                          color: T.dInk3,
                          size: 20,
                        ),
                        onPressed: () => setState(() => _show = !_show),
                      ),
                    ),

                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: T.mark.withValues(alpha: 0.12),
                          border: Border.all(color: T.mark.withValues(alpha: 0.4)),
                          borderRadius: BorderRadius.circular(3),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline, color: T.mark, size: 18),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _error!,
                                style: const TextStyle(color: T.dInk, fontSize: 13.5, height: 1.4),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      style: FilledButton.styleFrom(
                        backgroundColor: T.dInk,
                        foregroundColor: T.dBg,
                        disabledBackgroundColor: T.dInk.withValues(alpha: 0.4),
                      ),
                      child: _busy
                          ? const SizedBox(
                              width: 19,
                              height: 19,
                              child: CircularProgressIndicator(strokeWidth: 2, color: T.dBg),
                            )
                          : const Text('Sign in'),
                    ),

                    const SizedBox(height: 14),
                    TextButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const SignupScreen()),
                      ),
                      child: const Text(
                        'New here?  Create an account',
                        style: TextStyle(color: T.mark, fontSize: 13.5),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Divider(color: T.dBorder),
                    const SizedBox(height: 16),
                    // The same three assurances the web sign-in page makes.
                    for (final line in const [
                      'Sessions last eight hours.',
                      'Signing in never places or cancels an order.',
                      'Your money stays in your own Groww account.',
                    ])
                      Padding(
                        padding: const EdgeInsets.only(bottom: 7),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('·  ', style: TextStyle(color: T.dInk3)),
                            Expanded(
                              child: Text(
                                line,
                                style: const TextStyle(
                                  color: T.dInk3,
                                  fontSize: 12.5,
                                  height: 1.45,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _field({
    required TextEditingController controller,
    required String label,
    String? Function(String?)? validator,
    TextInputType? keyboard,
    bool obscure = false,
    Widget? suffix,
    VoidCallback? onSubmit,
  }) {
    return TextFormField(
      controller: controller,
      validator: validator,
      keyboardType: keyboard,
      obscureText: obscure,
      // "Next" on the email field moves to the password instead of dismissing
      // the keyboard; "Done" on the password submits. Without this the
      // keyboard offers no way forward and the form needs a deliberate tap.
      textInputAction: onSubmit == null ? TextInputAction.next : TextInputAction.done,
      autocorrect: false,
      enableSuggestions: false,
      style: const TextStyle(color: T.dInk, fontSize: 15),
      onFieldSubmitted: onSubmit == null ? null : (_) => onSubmit(),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: T.dInk3),
        filled: true,
        fillColor: T.dSurface,
        suffixIcon: suffix,
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: T.dBorder),
          borderRadius: BorderRadius.circular(3),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: T.mark, width: 1.5),
          borderRadius: BorderRadius.circular(3),
        ),
        errorBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: T.mark),
          borderRadius: BorderRadius.circular(3),
        ),
      ),
    );
  }
}
