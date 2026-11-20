import 'package:flutter/material.dart';
import '../api/client.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'legal.dart';
import 'shell.dart';

/// Registration — the web's `/signup`. Two steps: details, then the emailed
/// code.
///
/// An address that is already registered produces exactly the same screen and
/// the same wording as a new one. That is deliberate: the existing address is
/// mailed a notice rather than a code, so verification simply never succeeds,
/// and nothing here tells an unauthenticated caller which addresses exist.
class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});
  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  final _code = TextEditingController();
  final _form = GlobalKey<FormState>();

  bool _busy = false;
  String? _error;
  String? _token;
  String _masked = '';

  @override
  void dispose() {
    for (final c in [_email, _password, _confirm, _code]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
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

  Future<void> _start() async {
    if (!_form.currentState!.validate()) return;
    await _run(() async {
      final r = await api.signupStart(_email.text.trim(), _password.text);
      if (!mounted) return;
      setState(() {
        _token = r.token;
        _masked = r.maskedEmail;
      });
    });
  }

  Future<void> _resend() async {
    await _run(() => api.signupResend(_token!));
    // Captured after the await and guarded by this State's own `mounted`,
    // rather than reaching through a BuildContext that may be gone.
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(_error ?? 'Code sent again.')),
    );
  }

  Future<void> _verify() async {
    if (_code.text.trim().isEmpty) {
      setState(() => _error = 'Enter the code from your email.');
      return;
    }
    await _run(() async {
      final next = await api.signupVerify(_token!, _code.text.trim());
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => Shell(landing: next)),
        (_) => false,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final verifying = _token != null;
    return Scaffold(
      backgroundColor: T.dBg,
      appBar: AppBar(
        backgroundColor: T.dBg,
        foregroundColor: T.dInk,
        elevation: 0,
        shape: const Border(),
        title: const Text('Create account'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(26, 10, 26, 32),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const EnvBanner(),
                  Text(
                    verifying ? 'Check your email.' : 'Get started.',
                    style: const TextStyle(
                      fontSize: 28,
                      height: 1.1,
                      fontWeight: FontWeight.w600,
                      color: T.dInk,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    verifying
                        ? 'We sent a six-digit code to $_masked. It expires in ten minutes.'
                        : 'An account takes a minute. You connect a broker afterwards.',
                    style: const TextStyle(fontSize: 14, color: T.dInk3, height: 1.5),
                  ),
                  const SizedBox(height: 26),

                  if (!verifying) ...[
                    _field(_email, 'Email',
                        keyboard: TextInputType.emailAddress,
                        validator: (v) => (v == null || !v.contains('@'))
                            ? 'Enter your email address.'
                            : null),
                    const SizedBox(height: 13),
                    _field(_password, 'Password',
                        obscure: true,
                        validator: (v) => (v == null || v.length < 8)
                            ? 'Use at least 8 characters.'
                            : null),
                    const SizedBox(height: 13),
                    _field(_confirm, 'Confirm password',
                        obscure: true,
                        validator: (v) =>
                            v != _password.text ? 'Those passwords do not match.' : null),
                  ] else
                    _field(_code, 'Six-digit code',
                        keyboard: TextInputType.number, onSubmit: _verify),

                  if (_error != null) ...[
                    const SizedBox(height: 15),
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
                            child: Text(_error!,
                                style: const TextStyle(
                                    color: T.dInk, fontSize: 13.5, height: 1.4)),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : (verifying ? _verify : _start),
                    style: FilledButton.styleFrom(
                      backgroundColor: T.dInk,
                      foregroundColor: T.dBg,
                      disabledBackgroundColor: T.dInk.withValues(alpha: 0.4),
                    ),
                    child: _busy
                        ? const SizedBox(
                            width: 19,
                            height: 19,
                            child:
                                CircularProgressIndicator(strokeWidth: 2, color: T.dBg),
                          )
                        : Text(verifying ? 'Verify and continue' : 'Send code'),
                  ),

                  if (verifying) ...[
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: _busy ? null : _resend,
                      child: const Text('Send it again',
                          style: TextStyle(color: T.dInk3)),
                    ),
                  ],

                  const SizedBox(height: 22),
                  const Divider(color: T.dBorder),
                  const SizedBox(height: 14),
                  Text(
                    'By creating an account you accept the terms and the risk '
                    'disclosure. MNHA Financials is decision-support tooling, '
                    'not investment advice.',
                    style: const TextStyle(fontSize: 11.5, color: T.dInk3, height: 1.5),
                  ),
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      style: TextButton.styleFrom(padding: EdgeInsets.zero),
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const LegalScreen()),
                      ),
                      child: const Text('Read the terms',
                          style: TextStyle(color: T.mark, fontSize: 12.5)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController c,
    String label, {
    bool obscure = false,
    TextInputType? keyboard,
    String? Function(String?)? validator,
    VoidCallback? onSubmit,
  }) =>
      TextFormField(
        controller: c,
        obscureText: obscure,
        keyboardType: keyboard,
        validator: validator,
        textInputAction:
            onSubmit == null ? TextInputAction.next : TextInputAction.done,
        autocorrect: false,
        enableSuggestions: false,
        style: const TextStyle(color: T.dInk, fontSize: 15),
        onFieldSubmitted: onSubmit == null ? null : (_) => onSubmit(),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: const TextStyle(color: T.dInk3),
          filled: true,
          fillColor: T.dSurface,
          enabledBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: T.dBorder),
            borderRadius: BorderRadius.circular(3),
          ),
          focusedBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: T.mark, width: 1.5),
            borderRadius: BorderRadius.circular(3),
          ),
        ),
      );
}
